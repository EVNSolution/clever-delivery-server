export type AdminDriverAuthStatus = 'APP_LINKED' | 'INVITE_PENDING';
export type AdminDriverStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';

export type AdminDriverRow = {
  authStatus: AdminDriverAuthStatus;
  authSubject: 'present' | null;
  createdAt: string;
  displayName: string;
  id: string;
  lastSeenAt: string | null;
  phone: string | null;
  recentEventsCount: number;
  status: AdminDriverStatus;
  updatedAt: string;
};

export type CreatePendingDriverInput = {
  createdBy: string;
  displayName: string | null;
  inviteLink: string | null;
  phone: string;
  shopDomain: string;
  source: 'clever-app-driver-invite';
};

export type CreatePendingDriverRecordInput = {
  displayName: string | null;
  phone: string;
  shopDomain: string;
};

export type ListAdminDriversInput = {
  shopDomain: string;
};

export type AdminDriverServiceContract = {
  createPendingDriver(input: CreatePendingDriverInput): Promise<AdminDriverRow>;
  listDrivers(input: ListAdminDriversInput): Promise<AdminDriverRow[]>;
};
