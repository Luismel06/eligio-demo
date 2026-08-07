import { OperationalLogCategory } from './dto/operational-logs-query.dto';

export type OperationalLogMetadataValue = string | number | boolean | null;

export type OperationalLogMetadata = Record<string, OperationalLogMetadataValue>;

export type OperationalLog = {
  id: string;
  category: OperationalLogCategory;
  action: string;
  amount: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
  entity: string;
  entityId: string | null;
  orderId: string | null;
  invoiceId: string | null;
  documentNumber: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  status: string | null;
  destination: string | null;
  paymentMethod: string | null;
  cashRegisterName: string | null;
  detail: string | null;
  metadata: OperationalLogMetadata;
};
