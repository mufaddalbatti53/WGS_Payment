const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// 🚨 THE FIX 1: Use your LIVE MongoDB Atlas connection!
const dbURI = process.env.MONGODB_URI || 'mongodb+srv://admin:Mlhb1606@admin.tkins6m.mongodb.net/paymentApp?retryWrites=true&w=majority&appName=admin';

mongoose.connect(dbURI)
    .then(() => console.log("✅ Live Database Connected for Seeding..."))
    .catch(err => console.log("❌ DB Connection Error: ", err));

const seedDB = async () => {
    try {
        // 1. Delete existing users to avoid duplicates (Be careful with this on a live app!)
        // Removed dangerous User.deleteMany({}) to prevent accidental wiping of production users.
        console.log("⚠️ Existing users are kept intact. Please ensure you handle duplicates if needed.");

        // Use 10 salt rounds to match server.js perfectly
        const hashedPassword = await bcrypt.hash('admin123', 10);
        const hashedAnswer = await bcrypt.hash('dog', 10); // Answer to "first pet's name"

        // 2. Create the Admin
        const admin = new User({
            username: 'admin',
            password: hashedPassword,
            role: 'admin',
            securityQuestion: 'pet', // matches the HTML dropdown
            securityAnswer: hashedAnswer
        });

        // Save admin first so we can grab their ID!
        await admin.save();
        console.log(`✅ Admin created! (Username: admin, Password: admin123)`);

        // 3. Create a Staff member
        const staffPassword = await bcrypt.hash('staff123', 10);
        const staff = new User({
            username: 'staff',
            password: staffPassword,
            role: 'staff',
            adminId: admin._id, // 🚨 THE FIX 2: Correctly links this staff to the admin!
            securityQuestion: 'pet',
            securityAnswer: hashedAnswer
        });

        await staff.save();
        // 4. Create Super Admin if not exists
        const existingSuper = await User.findOne({ role: 'superadmin' });
        if (!existingSuper) {
            const superPassword = await bcrypt.hash('superadmin123', 10);
            const superAdmin = new User({
                username: 'superadmin',
                password: superPassword,
                plainPassword: 'superadmin123',
                role: 'superadmin',
                status: 'approved'
            });
            await superAdmin.save();
            console.log(`✅ Super Admin created! (Username: superadmin, Password: superadmin123)`);
        } else {
            console.log("ℹ️ Super Admin already exists.");
        }

        console.log("🎉 Database Seeded Successfully! You can now login.");

    } catch (error) {
        console.error("❌ Seeding Error:", error);
    } finally {
        // Always close the connection
        mongoose.connection.close();
        console.log("🔌 Connection closed.");
    }
};

seedDB();