import { DataTypes, Model, Sequelize } from 'sequelize';

export class Deposit extends Model {
  declare id: string;
  declare memberId: string;
  declare amount: string;
  declare turnoverMultiplier: string;
  declare providerId: string;
  declare pspRef: string;
  declare status: 'Pending' | 'Completed' | 'Failed';
}

export function initDeposit(sequelize: Sequelize): void {
  Deposit.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      turnoverMultiplier: { type: DataTypes.DECIMAL(36, 0), allowNull: false, defaultValue: '1' },
      providerId: { type: DataTypes.STRING(64), allowNull: false },
      pspRef: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'Pending' },
    },
    { sequelize, tableName: 'deposits', underscored: true },
  );
}
