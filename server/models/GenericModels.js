const mongoose = require('mongoose');

const createGenericModel = (modelName) => {
    const schema = new mongoose.Schema({
        id: { type: String, required: true, index: true },
        licenseKey: { type: String, index: true },
        branchId: { type: String, index: true }
    }, { strict: false, timestamps: true });
    
    schema.index({ id: 1, licenseKey: 1 }, { unique: true });
    return mongoose.model(modelName, schema);
};

module.exports = {
    Category: createGenericModel('Category'),
    SubCategory: createGenericModel('SubCategory'),
    ImportTracker: createGenericModel('ImportTracker'),
    BackupHistory: createGenericModel('BackupHistory'),
    ImportHistory: createGenericModel('ImportHistory'),
};
