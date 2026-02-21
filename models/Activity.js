const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    username: String,       // Who did it? (e.g., "Staff_Ali" or "Admin")
    action: String,         // What did they do? (e.g., "Updated Payment")
    details: String,        // Extra info (e.g., "Added ₹500 to Customer X")
    date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Activity', activitySchema);