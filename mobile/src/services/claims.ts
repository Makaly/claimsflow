/**
 * Claims API service. Wraps the backend /claims endpoints used by the
 * mobile app's claim list, detail and submission screens.
 */
import api from './api';

export type ClaimStatus =
  | 'submitted'
  | 'processing'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'paid';

export interface Claim {
  id: string;
  claimNumber?: string | null;
  status: ClaimStatus | string;
  invoiceAmount?: number | null;
  providerName?: string | null;
  memberNumber?: string | null;
  diagnosis?: string | null;
  dateOfService?: string | null;
  submittedAt?: string | null;
  createdAt: string;
}

export interface LineItem {
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  totalPrice?: number | null;
}

export interface NewClaimPayload {
  providerName: string;
  memberNumber: string;
  invoiceAmount: number;
  diagnosis?: string;
  dateOfService?: string;
}

/** List the authenticated member's claims, most recent first. */
export async function listClaims(): Promise<Claim[]> {
  const { data } = await api.get<Claim[]>('/claims');
  return data;
}

/** Fetch a single claim by id. */
export async function getClaim(id: string): Promise<Claim> {
  const { data } = await api.get<Claim>(`/claims/${id}`);
  return data;
}

/** Fetch the extracted invoice line items for a claim. */
export async function getClaimLineItems(id: string): Promise<LineItem[]> {
  const { data } = await api.get<LineItem[]>(`/claims/${id}/line-items`);
  return data;
}

/** Submit a new claim. */
export async function createClaim(payload: NewClaimPayload): Promise<Claim> {
  const { data } = await api.post<Claim>('/claims', payload);
  return data;
}
