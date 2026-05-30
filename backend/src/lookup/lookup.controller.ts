import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { LookupService } from './lookup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const lookupStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(process.cwd(), 'uploads', 'lookups');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `lookup-${unique}${extname(file.originalname)}`);
  },
});

@Controller('lookups')
@UseGuards(JwtAuthGuard)
export class LookupController {
  constructor(private readonly lookupService: LookupService) {}

  // ── Resolution (available to anyone uploading/indexing) ─────────────────────

  /** Resolve one key against one source. Returns the matched row (flat map). */
  @Get('query')
  async query(@Query('sourceId') sourceId: string, @Query('key') key: string) {
    if (!sourceId || !key) throw new BadRequestException('sourceId and key are required');
    const result = await this.lookupService.query(sourceId, key);
    return { sourceId, key, found: !!result, result };
  }

  // ── Source management ───────────────────────────────────────────────────────

  @Get('sources')
  listSources(@Query('active') active?: string) {
    return this.lookupService.listSources(active === 'true');
  }

  @Get('sources/:id')
  getSource(@Param('id') id: string) {
    return this.lookupService.getSource(id);
  }

  @Get('sources/:id/preview')
  preview(@Param('id') id: string, @Query('take') take?: string) {
    return this.lookupService.previewRows(id, take ? parseInt(take, 10) : 10);
  }

  @Post('sources')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  createSource(@Body() body: any, @Request() req: any) {
    return this.lookupService.createSource(body, req.user?.userId);
  }

  @Patch('sources/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  updateSource(@Param('id') id: string, @Body() body: any) {
    return this.lookupService.updateSource(id, body);
  }

  @Delete('sources/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  deleteSource(@Param('id') id: string) {
    return this.lookupService.deleteSource(id);
  }

  /** Upload an Excel/CSV file to (re)populate a file-backed source. */
  @Post('sources/:id/upload')
  @UseGuards(RolesGuard)
  @Roles('admin', 'claims_officer')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: lookupStorage,
      fileFilter: (_req, file, cb) => {
        if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
          return cb(new BadRequestException('Only .xlsx, .xls and .csv files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('keyColumn') keyColumn?: string,
  ) {
    if (!file) throw new NotFoundException('file is required');
    return this.lookupService.ingestFile(id, file, keyColumn);
  }
}
