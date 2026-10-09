import { DataTypes, Model, Sequelize } from 'sequelize';

export class Withdrawal extends Model {
  declare id: string;
  declare memberId: string;
  declare amount: string;
  declare status: 'Pending';
}

export function initWithdrawal(sequelize: Sequelize): void {
  Withdrawal.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      memberId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(36, 18), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'Pending' },
    },
    { sequelize, tableName: 'withdrawals', underscored: true },
  );
}
