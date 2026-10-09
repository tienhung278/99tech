import { DataTypes, Model, Sequelize } from 'sequelize';

export type ReportedCallbackStatus = 'pending' | 'completed' | 'failed';
export type CallbackAuditOutcome =
  | 'unknown_reference'
  | 'amount_mismatch'
  | 'stale_pending'
  | 'contradictory_terminal';

export class PspCallbackAudit extends Model {
  declare id: string;
  declare providerId: string;
  declare pspRef: string;
  declare depositId: string | null;
  declare reportedStatus: ReportedCallbackStatus;
  declare reportedAmount: string;
  declare outcome: CallbackAuditOutcome;
  declare reconciliationRequired: boolean;
}

export function initPspCallbackAudit(sequelize: Sequelize): void {
  PspCallbackAudit.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      providerId: { type: DataTypes.STRING(64), allowNull: false },
      pspRef: { type: DataTypes.TEXT, allowNull: false },
      depositId: { type: DataTypes.UUID, allowNull: true },
      reportedStatus: { type: DataTypes.STRING(16), allowNull: false },
      reportedAmount: { type: DataTypes.TEXT, allowNull: false },
      outcome: { type: DataTypes.STRING(32), allowNull: false },
      reconciliationRequired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, tableName: 'psp_callback_audits', underscored: true, updatedAt: false },
  );
}
