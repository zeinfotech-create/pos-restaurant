const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    try {
        console.log('Connecting to', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI, { dbName: 'pos_db' });
        const Setting = mongoose.model('SettingCheck2', new mongoose.Schema({}, { strict: false, collection: 'settings' }));
        
        const settings = await Setting.find({}).sort({ updatedAt: -1 }).limit(10);
        console.log(`Found ${settings.length} settings records.`);
        settings.forEach(s => {
            console.log(JSON.stringify(s, null, 2));
            console.log('-------------------');
        });
        
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
