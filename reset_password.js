const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// 🚨 THE FIX: Use your live MongoDB Atlas connection string!
const dbURI = process.env.MONGODB_URI || 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

mongoose.connect(dbURI)
    .then(() => console.log("✅ Live Database Connected for Reset..."))
    .catch(err => console.log("❌ DB Connection Error: ", err));

const resetAdmin = async () => {
    try {
        // 1. Choose the new password you want
        const newPasswordRaw = "newAdmin123";

        // 2. Encrypt (Hash) it exactly as your server.js does (salt rounds = 10)
        const hashedPassword = await bcrypt.hash(newPasswordRaw, 10);

        // 3. Find the user 'admin' and update their password
        // (If your username is different, change 'admin' below)
        const updatedUser = await User.findOneAndUpdate(
            { username: 'admin' },
            { password: hashedPassword },
            { new: true }
        );

        if (updatedUser) {
            console.log(`✅ Success! Password for '${updatedUser.username}' changed to: ${newPasswordRaw}`);
        } else {
            console.log("❌ Error: User 'admin' not found in the live database.");
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