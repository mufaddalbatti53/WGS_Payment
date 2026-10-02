const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// 🚨 THE FIX: Use your live MongoDB Atlas connection string!
const dbURI = process.env.MONGODB_URI;
if (!dbURI) {
    throw new Error('MONGODB_URI must be configured before running this script.');
}

mongoose.connect(dbURI)
    .then(() => console.log("✅ Live Database Connected for Reset..."))
    .catch(err => console.log("❌ DB Connection Error: ", err));

const resetAdmin = async () => {
    try {
        const username = process.env.RESET_USERNAME;
        const newPasswordRaw = process.env.RESET_PASSWORD;
        if (!username || !newPasswordRaw) {
            throw new Error('RESET_USERNAME and RESET_PASSWORD must be configured.');
        }

        const hashedPassword = await bcrypt.hash(newPasswordRaw, 12);

        const updatedUser = await User.findOneAndUpdate(
            { username },
            { password: hashedPassword },
            { new: true }
        );

        if (updatedUser) {
            console.log(`✅ Password for '${updatedUser.username}' changed.`);
        } else {
            console.log(`❌ User '${username}' not found in the live database.`);
        }
    } catch (error) {
        console.error("❌ An error occurred during reset:", error);
    } finally {
        // Always close the connection when done!
        mongoose.connection.close();
        console.log("🔌 Connection closed.");
    }
};

resetAdmin();