'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_ledger_entries', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      event_key: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE wallet_ledger_entries
      ADD CONSTRAINT wallet_ledger_entries_nonzero_amount CHECK (amount <> 0)
    `);
    await queryInterface.sequelize.query(`
      CREATE FUNCTION reject_wallet_ledger_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet ledger entries are immutable';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER wallet_ledger_entries_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION reject_wallet_ledger_mutation();
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('wallet_ledger_entries');
    await queryInterface.sequelize.query('DROP FUNCTION reject_wallet_ledger_mutation()');
  },
};
