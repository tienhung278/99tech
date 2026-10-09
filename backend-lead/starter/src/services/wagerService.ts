import { sequelize } from '../db/sequelize';
import { Wager, Wallet, WalletLedgerEntry } from '../db/models';
import { dec } from '../lib/money';

export type WagerResult =
  | { kind: 'created'; wager: Wager }
  | { kind: 'not_found' }
  | { kind: 'wallet_frozen' }
  | { kind: 'insufficient_funds' };

export async function placeWager(walletId: string, amount: string): Promise<WagerResult> {
  return sequelize.transaction(async (transaction) => {
    const wallet = await Wallet.findByPk(walletId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) return { kind: 'not_found' };
    if (wallet.frozen) return { kind: 'wallet_frozen' };
    const nextBalance = dec(wallet.balance).minus(amount);
    if (nextBalance.isNegative()) return { kind: 'insufficient_funds' };

    const wager = await Wager.create({ walletId, amount }, { transaction });
    await WalletLedgerEntry.create({
      walletId,
      eventKey: `wager:${wager.id}`,
      amount: dec(amount).negated().toFixed(18),
    }, { transaction });
    await wallet.update({ balance: nextBalance.toFixed(18) }, { transaction });
    return { kind: 'created', wager };
  });
}
