const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect('mongodb://127.0.0.1:27017/paymentApp')
    .then(() => console.log("Connected to DB"))
    .catch(err => console.log(err));

const seedDB = async () => {
    // 1. Delete existing users to avoid duplicates
    await User.deleteMany({});

    // 2. Hash the password "admin123"
    const hashedPassword = await bcrypt.hash('admin123', 12);

    // 3. Create the Admin
    const admin = new User({
        username: 'admin',
        password: hashedPassword,
        role: 'admin'
    });

    // 4. Create a Staff member (Optional)
    const staffPassword = await bcrypt.hash('staff123', 12);
    const staff = new User({
        username: 'staff',
        password: staffPassword,
        role: 'staff'
    });

    await admin.save();
    await staff.save();
    console.log("Database Seeded! You can now login.");
};

seedDB().then(() => {
    mongoose.connection.close();

});
