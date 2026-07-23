const DBManager = {
    getType: () => 'mongodb',

    /**
     * Generic find operation (MongoDB).
     * @param {Object} Model  - Mongoose Model
     * @param {string} store  - unused for MongoDB (kept for call-site compatibility)
     * @param {Object} query  - Query object
     * @param {Object} options - { sort, limit }
     */
    async find(Model, store, query, options = {}) {
        let q = Model.find(query);
        if (options.sort) q = q.sort(options.sort);
        if (options.limit) q = q.limit(options.limit);
        return await q.lean();
    },

    async findOne(Model, store, query, sort = null) {
        const results = await this.find(Model, store, query, { sort, limit: 1 });
        return results.length > 0 ? results[0] : null;
    },

    /**
     * Generic insert — delegates to upsert with auto-generated ID.
     */
    async insert(Model, store, data) {
        const id = data.id || data.productId || data.userId || data.registerId || data.branchId || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        return await this.upsert(Model, store, { id }, { ...data, id });
    },

    async count(Model, store, query) {
        return await Model.countDocuments(query);
    },

    async aggregateSum(Model, store, query, sumField) {
        const res = await Model.aggregate([
            { $match: query },
            { $group: { _id: null, total: { $sum: `$${sumField}` } } }
        ]);
        return res.length > 0 ? res[0].total : 0;
    },

    /**
     * Generic upsert — INCOMING data always wins over stored data.
     */
    async upsert(Model, store, query, data) {
        return await Model.findOneAndUpdate(query, { $set: data }, { upsert: true, new: true, lean: true });
    },

    /**
     * delete — remove matching records.
     */
    async delete(Model, store, query) {
        return await Model.deleteMany(query);
    },

    /**
     * deleteOne — deletes a single matching record.
     */
    async deleteOne(Model, store, query) {
        return await Model.deleteOne(query);
    },

    /**
     * updateMany — updates all matching records with a partial patch.
     */
    async updateMany(Model, store, query, update) {
        return await Model.updateMany(query, update);
    },

    /**
     * exportAll — returns all records for a license across the given stores.
     * Used for backup.
     */
    async exportAll(ModelMap, licenseKey) {
        const backup = {
            licenseKey,
            exportedAt: new Date().toISOString(),
            version: '2.0',
            stores: {}
        };

        for (const [store, Model] of Object.entries(ModelMap)) {
            try {
                const docs = await this.find(Model, store, { licenseKey });
                backup.stores[store] = docs;
            } catch (err) {
                console.error(`[DB] exportAll error for ${store}:`, err.message);
                backup.stores[store] = [];
            }
        }

        return backup;
    },

    /**
     * importAll — restores records for a license from a backup object.
     * NOTE: This MERGES data — it does NOT wipe existing records first.
     * Set wipe=true to clear each store before importing.
     */
    async importAll(ModelMap, backup, wipe = false) {
        const results = {};
        const licenseKey = backup.licenseKey;

        for (const [store, docs] of Object.entries(backup.stores || {})) {
            const Model = ModelMap[store];
            if (!Model || !Array.isArray(docs)) {
                results[store] = { skipped: true };
                continue;
            }

            try {
                if (wipe) {
                    await this.delete(Model, store, { licenseKey });
                }

                let count = 0;
                for (const doc of docs) {
                    await this.upsert(Model, store, { id: doc.id, licenseKey }, { ...doc, licenseKey });
                    count++;
                }
                results[store] = { imported: count };
            } catch (err) {
                console.error(`[DB] importAll error for ${store}:`, err.message);
                results[store] = { error: err.message };
            }
        }

        return results;
    }
};

module.exports = DBManager;
