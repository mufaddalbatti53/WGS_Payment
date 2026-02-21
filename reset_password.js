const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// Connect to your DB
mongoose.connect('mongodb://127.0.0.1:27017/paymentApp')
    .then(() => console.log("Database Connected for Reset..."))
    .catch(err => console.log(err));

const resetAdmin = async () => {
    // 1. Choose the new password you want
    const newPasswordRaw = "newAdmin123";

    // 2. Encrypt (Hash) it
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPasswordRaw, salt);

    // 3. Find the user 'admin' and update their password
    // (If your username is different, change 'admin' below)
    const updatedUser = await User.findOneAndUpdate(
        { username: 'admin' },
        { password: hashedPassword },
        { new: true } // This option returns the updated document
    );

    if (updatedUser) {
        console.log("✅ Success! Password for 'admin' changed to: " + newPasswordRaw);
    } else {
        console.log("❌ Error: User 'admin' not found.");
    }

    mongoose.connection.close();
};

resetAdmin();