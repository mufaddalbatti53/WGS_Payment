require('dotenv').config();

const mongoose = require('mongoose');

const dbURI = process.env.MONGODB_URI;
if (!dbURI) {
    throw new Error('MONGODB_URI must be configured before running the security migration.');
}

async function main() {
    await mongoose.connect(dbURI);
    const result = await mongoose.connection.db.collection('users').updateMany(
        { plainPassword: { $exists: true } },
        { $unset: { plainPassword: '' } }
    );
    console.log(`Removed legacy plaintext passwords from ${result.modifiedCount} user record(s).`);
}

main()
    .catch(err => {
        console.error('Security migration failed:', err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
        }
    });
