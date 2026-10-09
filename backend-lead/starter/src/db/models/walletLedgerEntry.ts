import { DataTypes, Model, Sequelize } from 'sequelize';

export class WalletLedgerEntry extends Model {
  declare id: string;
  declare walletId: string;
  declare eventKey: string;
  declare amount: string;
}

export function initWalletLedgerEntry(sequelize: Sequelize): void {
  WalletLedgerEntry.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      walletId: { type: DataTypes.UUID, allowNull: false },
      eventKey: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
    },
    { sequelize, tableName: 'wallet_ledger_entries', underscored: true, updatedAt: false },
  );
}
