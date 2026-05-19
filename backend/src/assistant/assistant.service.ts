import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiLlmAdapter } from './gemini-llm.adapter';
import * as fs from 'fs';
import * as path from 'path';

export interface Citation {
  source: string;
  excerpt: string;
}

export interface AssistantQueryResult {
  answer: string;
  citations: Citation[];
  topSimilarity: number;
  refused: boolean;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly similarityThreshold: number;
  private readonly corpusDir: string;

  constructor(
    private prisma: PrismaService,
    private llm: GeminiLlmAdapter,
    private config: ConfigService,
  ) {
    this.similarityThreshold = parseFloat(
      config.get('ASSISTANT_SIMILARITY_THRESHOLD', '0.75'),
    );
    this.corpusDir = config.get('ASSISTANT_CORPUS_DIR', './corpus');
  }

  /**
   * Index all Markdown files from the corpus directory.
   * Call on startup or via admin trigger; idempotent (upserts by source).
   * TODO: extend to PDF using pdf-parse once package is added.
   */
  async indexCorpus(): Promise<{ indexed: number }> {
    if (!fs.existsSync(this.corpusDir)) {
      this.logger.warn(`Corpus dir ${this.corpusDir} not found — skipping index`);
      return { indexed: 0 };
    }
    const files = fs.readdirSync(this.corpusDir).filter((f) => f.endsWith('.md'));
    let indexed = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.corpusDir, file), 'utf-8');
      const source = file;
      const embedding = await this.llm.embed(content.slice(0, 8000));
      // Raw SQL to insert vector — Prisma doesn't support Unsupported type in write ops
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO assistant_documents(id, source, content, embedding, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::TEXT, $1, $2, $3::vector, NOW(), NOW())
         ON CONFLICT(source) DO UPDATE
           SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, "updatedAt" = NOW()`,
        source,
        content,
        `[${embedding.join(',')}]`,
      );
      indexed++;
    }
    return { indexed };
  }

  async query(userId: string | undefined, question: string): Promise<AssistantQueryResult> {
    const queryEmbedding = await this.llm.embed(question);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    // Retrieve top-5 semantically similar chunks using pgvector cosine distance
    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; source: string; content: string; similarity: number }[]
    >(
      `SELECT id, source, content,
              1 - (embedding <=> $1::vector) AS similarity
       FROM assistant_documents
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      vectorLiteral,
    );

    const topSimilarity = rows[0]?.similarity ?? 0;

    if (topSimilarity < this.similarityThreshold) {
      // Refuse when retrieval quality is below threshold to avoid hallucination
      await this.prisma.assistantInteraction.create({
        data: {
          userId,
          query: question,
          answer: '',
          citations: [],
          topSimilarity,
          refused: true,
        },
      });
      return {
        answer:
          'I could not find sufficiently relevant information in the policy corpus to answer this question. Please consult the source documents directly.',
        citations: [],
        topSimilarity,
        refused: true,
      };
    }

    const context = rows.map((r) => `[${r.source}]\n${r.content.slice(0, 1000)}`).join('\n\n---\n\n');
    const systemPrompt = `You are ClaimsFlow's policy assistant for CIC Insurance Group.
Answer only from the provided context. If the answer is not clearly supported, say so.
Context:
${context}`;

    const answer = await this.llm.generate(systemPrompt, question);
    const citations: Citation[] = rows.map((r) => ({
      source: r.source,
      excerpt: r.content.slice(0, 200),
    }));

    await this.prisma.assistantInteraction.create({
      data: {
        userId,
        query: question,
        answer,
        citations: citations as any,
        topSimilarity,
        refused: false,
      },
    });

    return { answer, citations, topSimilarity, refused: false };
  }

  async getInteractions(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.assistantInteraction.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.assistantInteraction.count(),
    ]);
    return { data, total, page, limit };
  }
}
