require('dotenv').config();
const nodemailer = require('nodemailer');

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: (parseInt(process.env.SMTP_PORT) || 465) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

console.log('Testing connection to', process.env.SMTP_HOST, 'on port', process.env.SMTP_PORT);

emailTransporter.verify(function (error, success) {
    if (error) {
        console.error('SMTP Connection Error:');
        console.error(error);
        process.exit(1);
    } else {
        console.log('Server is ready to take our messages');
        process.exit(0);
    }
});
