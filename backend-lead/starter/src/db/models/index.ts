import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { Deposit, initDeposit } from './deposit';
import { WalletLedgerEntry, initWalletLedgerEntry } from './walletLedgerEntry';
import { PspCallbackAudit, initPspCallbackAudit } from './pspCallbackAudit';
import { Wager, initWager } from './wager';

initMember(sequelize);
initWallet(sequelize);
initDeposit(sequelize);
initWalletLedgerEntry(sequelize);
initPspCallbackAudit(sequelize);
initWager(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Member.hasMany(Deposit, { foreignKey: 'memberId', as: 'deposits' });
Deposit.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Wallet.hasMany(WalletLedgerEntry, { foreignKey: 'walletId', as: 'ledgerEntries' });
WalletLedgerEntry.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });
Wallet.hasMany(Wager, { foreignKey: 'walletId', as: 'wagers' });
Wager.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' });

export { Member, Wallet, Deposit, WalletLedgerEntry, PspCallbackAudit, Wager };
