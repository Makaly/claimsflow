export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'claims_officer' | 'maker_checker' | 'fraud_officer' | 'finance' | 'provider_admin' | 'provider_user'
  isActive: boolean
  twoFactorEnabled: boolean
  providerId?: string
  provider?: Provider
  branchId?: string         // set for provider_user accounts tied to a specific branch
  lastLogin?: string
  createdAt: string
  updatedAt: string
  // Extended profile fields (per-user, persisted in DB)
  phone?: string
  jobTitle?: string
  department?: string
  location?: string
  timezone?: string
  language?: string
  bio?: string
  avatarUrl?: string
}

export interface Provider {
  id: string
  name: string
  type: 'hospital' | 'clinic' | 'pharmacy' | 'lab'
  licenseNumber: string
  contactPerson: string
  email: string
  phone: string
  physicalAddress: string
  city?: string
  region?: string
  status: 'pending' | 'approved' | 'suspended' | 'rejected'
  approvalStatus: string
  isActive: boolean
  canSubmitClaims: boolean
  maxDailySubmissions?: number
  branches?: Provider[]
  createdAt: string
  updatedAt: string
}

export interface Claim {
  id: string
  claimNumber: string
  batchNumber?: string
  barcode: string
  providerId: string
  provider?: Provider
  memberNumber?: string
  memberName?: string
  patientName?: string
  invoiceNumber?: string
  invoiceDate?: string
  invoiceAmount?: number
  dateOfService?: string
  diagnosis?: string
  treatment?: string
  status: 'submitted' | 'under_review' | 'incomplete' | 'resubmitted' | 'approved' | 'rejected' | 'paid'
  workflowStage: 'initial_review' | 'maker_checker_review' | 'claims_officer_review' | 'fraud_review' | 'payment_pending' | 'completed'
  assignedTo?: string
  assignedUser?: User
  priority: 'urgent' | 'high' | 'normal' | 'low'
  isRejected: boolean
  rejectionReason?: string
  isComplete: boolean
  missingDocuments: string[]
  ocrStatus: string
  ocrConfidence?: number
  notes?: string
  documents?: Document[]
  approvals?: ClaimApproval[]
  submittedAt: string
  createdAt: string
  updatedAt: string
}

export interface ClaimApproval {
  id: string
  claimId: string
  level: 'maker' | 'maker_checker' | 'claims_officer'
  approvalStage: string
  approvedBy: string
  approver?: User
  decision: 'approved' | 'rejected' | 'returned'
  comments?: string
  createdAt: string
}

export interface BatchSubmission {
  id: string
  batchNumber: string
  providerId: string
  provider?: Provider
  submissionMethod: string
  totalClaims: number
  status: 'uploading' | 'processing' | 'completed' | 'failed'
  processedClaims: number
  failedClaims: number
  createdAt: string
  completedAt?: string
}

export interface Document {
  id: string
  filename: string
  originalName: string
  mimetype: string
  size: number
  path: string
  documentType?: string
  claimId?: string
  ocrStatus: string
  ocrConfidence?: number
  pageCount?: number
  createdAt: string
}

export interface ActivityLog {
  id: string
  userId?: string
  user?: User
  username?: string
  userRole?: string
  action: string
  entity?: string
  entityId?: string
  ipAddress?: string
  status: string
  createdAt: string
}

export interface WorkflowStatistics {
  initial_review: number
  maker_checker_review: number
  claims_officer_review: number
  fraud_review: number
  completed: number
  total: number
}

export interface DashboardStats {
  totalClaims: number
  pendingClaims: number
  approvedClaims: number
  rejectedClaims: number
  totalProviders: number
  activeProviders: number
  totalAmount: number
  avgProcessingTime: number
}

export interface Notification {
  id: string
  type: string
  subject?: string
  message: string
  status: 'pending' | 'sent' | 'read'
  createdAt: string
}
