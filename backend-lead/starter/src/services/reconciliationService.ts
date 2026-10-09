import { QueryTypes } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { Wallet } from '../db/models';
import { dec } from '../lib/money';

export type ReconciliationResult =
  | { kind: 'not_found' }
  | {
      kind: 'reconciled';
      walletId: string;
      ledgerTotal: string;
      operationalBalance: string;
      difference: string;
      differenceBasis: 'ledgerTotal - operationalBalance';
      frozen: boolean;
    };

export async function reconcileWallet(walletId: string): Promise<ReconciliationResult> {
  return sequelize.transaction(async (transaction) => {
    const wallet = await Wallet.findByPk(walletId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) return { kind: 'not_found' };

    const [row] = await sequelize.query<{ total: string }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_ledger_entries WHERE wallet_id = :walletId',
      { replacements: { walletId }, transaction, type: QueryTypes.SELECT },
    );
    // Positive means the ledger exceeds the operational balance; negative means it is short.
    const difference = dec(row.total).minus(wallet.balance);
    if (!difference.isZero() && !wallet.frozen) {
      await wallet.update({ frozen: true }, { transaction });
    }
    return {
      kind: 'reconciled',
      walletId,
      ledgerTotal: dec(row.total).toFixed(18),
      operationalBalance: dec(wallet.balance).toFixed(18),
      difference: difference.toFixed(18),
      differenceBasis: 'ledgerTotal - operationalBalance',
      frozen: wallet.frozen,
    };
  });
}
