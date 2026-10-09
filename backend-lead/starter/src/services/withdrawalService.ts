import { QueryTypes } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { Wallet, WalletLedgerEntry, Withdrawal } from '../db/models';
import { dec } from '../lib/money';

export type WithdrawalResult =
  | { kind: 'created'; withdrawal: Withdrawal }
  | { kind: 'not_found' }
  | { kind: 'outstanding_turnover'; outstandingTurnover: string }
  | { kind: 'insufficient_funds' };

export async function requestWithdrawal(memberId: string, amount: string): Promise<WithdrawalResult> {
  return sequelize.transaction(async (transaction) => {
    const wallet = await Wallet.findOne({
      where: { memberId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) return { kind: 'not_found' };

    // These aggregates must be read after the wallet lock. Every writer of a
    // completed deposit or accepted wager also holds that lock through commit.
    const [required] = await sequelize.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount * turnover_multiplier), 0) AS total
       FROM deposits WHERE member_id = :memberId AND status = 'Completed'`,
      { replacements: { memberId }, transaction, type: QueryTypes.SELECT },
    );
    const [accrued] = await sequelize.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM wagers WHERE wallet_id = :walletId`,
      { replacements: { walletId: wallet.id }, transaction, type: QueryTypes.SELECT },
    );
    const remaining = dec(required.total).minus(accrued.total);
    if (remaining.isGreaterThan(0)) {
      return { kind: 'outstanding_turnover', outstandingTurnover: remaining.toFixed(18) };
    }

    const nextBalance = dec(wallet.balance).minus(amount);
    if (nextBalance.isNegative()) return { kind: 'insufficient_funds' };

    const withdrawal = await Withdrawal.create({ memberId, amount, status: 'Pending' }, { transaction });
    await WalletLedgerEntry.create({
      walletId: wallet.id,
      eventKey: `withdrawal:${withdrawal.id}`,
      amount: dec(amount).negated().toFixed(18),
    }, { transaction });
    await wallet.update({ balance: nextBalance.toFixed(18) }, { transaction });
    return { kind: 'created', withdrawal };
  });
}
