import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

function getTransporter() {
    const host = process.env.MAIL_HOST;
    const port = parseInt(process.env.MAIL_PORT || '587');
    const username = process.env.MAIL_USERNAME;
    const password = process.env.MAIL_PASSWORD;

    if (!host || !username || !password) {
        const missing = [];
        if (!process.env.MAIL_HOST) missing.push('MAIL_HOST');
        if (!process.env.MAIL_USERNAME) missing.push('MAIL_USERNAME');
        if (!process.env.MAIL_PASSWORD) missing.push('MAIL_PASSWORD');
        throw new Error(`Missing email configuration: ${missing.join(', ')}. Please set these in your .env file.`);
    }

    return nodemailer.createTransport({
        host: host,
        port: port,
        secure: false,
        auth: {
            user: username,
            pass: password
        },
        tls: {
            rejectUnauthorized: false,
            requireTLS: true,
            ciphers: 'SSLv3'
        }
    });
}

export async function sendOTPEmail(email, otpCode) {
    const transporter = getTransporter();

    const fromName = 'Dansthorized Bot Control Panel';
    const fromAddress = process.env.MAIL_USERNAME;
    const subject = 'Your Verification Code';

    const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: subject,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6; 
                        color: #000000; 
                        background-color: #ffffff;
                    }
                    .email-wrapper { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background-color: #ffffff;
                        border: 1px solid #e0e0e0;
                    }
                    .header { 
                        background-color: #dc2626;
                        color: #ffffff; 
                        padding: 40px 30px; 
                        text-align: center; 
                    }
                    .header h1 {
                        font-size: 28px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                        color: #ffffff;
                    }
                    .header p {
                        font-size: 14px;
                        color: #ffffff;
                        font-weight: 300;
                    }
                    .content { 
                        background-color: #ffffff; 
                        padding: 40px 30px; 
                    }
                    .content p {
                        font-size: 16px;
                        color: #000000;
                        margin-bottom: 16px;
                    }
                    .content p:first-child {
                        font-size: 18px;
                        color: #000000;
                        font-weight: 500;
                        margin-bottom: 20px;
                    }
                    .otp-container {
                        margin: 30px 0;
                        text-align: center;
                    }
                    .otp-label {
                        font-size: 14px;
                        color: #666666;
                        margin-bottom: 12px;
                        font-weight: 500;
                        text-transform: uppercase;
                        letter-spacing: 1px;
                    }
                    .otp-code { 
                        background-color: #000000;
                        color: #ffffff; 
                        font-size: 36px; 
                        font-weight: 700; 
                        text-align: center; 
                        padding: 24px 32px; 
                        margin: 0 auto;
                        border-radius: 8px; 
                        letter-spacing: 12px; 
                        display: inline-block;
                        border: 2px solid #000000;
                        font-family: 'Courier New', monospace;
                    }
                    .expiry-notice {
                        background-color: #fff3cd;
                        border: 2px solid #ffc107;
                        padding: 16px;
                        margin: 24px 0;
                        border-radius: 4px;
                    }
                    .expiry-notice p {
                        margin: 0;
                        font-size: 14px;
                        color: #856404;
                    }
                    .security-notice {
                        background-color: #ffffff;
                        padding: 16px;
                        margin: 24px 0;
                        border-radius: 8px;
                        border: 2px solid #cccccc;
                    }
                    .security-notice p {
                        margin: 0;
                        font-size: 14px;
                        color: #000000;
                        line-height: 1.5;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 30px;
                        background-color: #f5f5f5;
                        border-top: 1px solid #e0e0e0;
                    }
                    .footer p {
                        font-size: 13px;
                        color: #666666;
                        margin: 4px 0;
                    }
                    .footer .brand {
                        color: #dc2626;
                        font-weight: 600;
                    }
                    @media only screen and (max-width: 600px) {
                        .content { padding: 30px 20px; }
                        .header { padding: 30px 20px; }
                        .header h1 { font-size: 24px; }
                        .otp-code { 
                            font-size: 28px; 
                            padding: 20px 24px;
                            letter-spacing: 8px;
                        }
                    }
                </style>
            </head>
            <body style="background-color: #ffffff; padding: 20px;">
                <div class="email-wrapper">
                    <div class="header">
                        <h1>🔐 Verification Code</h1>
                        <p>Dansthorized Bot Control Panel</p>
                    </div>
                    <div class="content">
                        <p>Hello,</p>
                        <p>You've requested a verification code to access your account. Use the code below to complete your verification:</p>
                        
                        <div class="otp-container">
                            <div class="otp-label">Your Verification Code</div>
                            <div class="otp-code">${otpCode}</div>
                        </div>
                        
                        <div class="expiry-notice">
                            <p><strong>⏰ Important:</strong> This code will expire in 10 minutes for security reasons.</p>
                        </div>
                        
                        <div class="security-notice">
                            <p><strong>🔒 Security Notice:</strong> If you didn't request this verification code, please ignore this email. Your account remains secure and no changes have been made.</p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} <span class="brand">${fromName}</span>. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

export async function sendVerificationSuccessEmail(email, username) {
    const transporter = getTransporter();

    const fromName = 'Dansthorized Bot Control Panel';
    const fromAddress = process.env.MAIL_USERNAME;
    const subject = 'Email Verified Successfully';

    const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: subject,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6; 
                        color: #000000; 
                        background-color: #ffffff;
                    }
                    .email-wrapper { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background-color: #ffffff;
                        border: 1px solid #e0e0e0;
                    }
                    .header { 
                        background-color: #10b981;
                        color: #ffffff; 
                        padding: 40px 30px; 
                        text-align: center; 
                    }
                    .header h1 {
                        font-size: 28px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                        color: #ffffff;
                    }
                    .header p {
                        font-size: 14px;
                        color: #ffffff;
                        font-weight: 300;
                    }
                    .content { 
                        background-color: #ffffff; 
                        padding: 40px 30px; 
                    }
                    .content p {
                        font-size: 16px;
                        color: #000000;
                        margin-bottom: 16px;
                    }
                    .content p:first-child {
                        font-size: 18px;
                        color: #000000;
                        font-weight: 500;
                        margin-bottom: 20px;
                    }
                    .success-box {
                        background-color: #d4edda;
                        border: 2px solid #10b981;
                        padding: 24px;
                        margin: 30px 0;
                        border-radius: 8px;
                        text-align: center;
                    }
                    .success-box .icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                    }
                    .success-box p {
                        margin: 0;
                        font-size: 18px;
                        color: #155724;
                        font-weight: 600;
                    }
                    .info-box {
                        background-color: #ffffff;
                        padding: 20px;
                        margin: 24px 0;
                        border-radius: 8px;
                        border: 2px solid #0066cc;
                        border-left: 4px solid #0066cc;
                    }
                    .info-box p {
                        margin: 0;
                        font-size: 14px;
                        color: #000000;
                        line-height: 1.6;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 30px;
                        background-color: #f5f5f5;
                        border-top: 1px solid #e0e0e0;
                    }
                    .footer p {
                        font-size: 13px;
                        color: #666666;
                        margin: 4px 0;
                    }
                    .footer .brand {
                        color: #dc2626;
                        font-weight: 600;
                    }
                    @media only screen and (max-width: 600px) {
                        .content { padding: 30px 20px; }
                        .header { padding: 30px 20px; }
                        .header h1 { font-size: 24px; }
                    }
                </style>
            </head>
            <body style="background-color: #ffffff; padding: 20px;">
                <div class="email-wrapper">
                    <div class="header">
                        <h1>✅ Email Verified</h1>
                        <p>Dansthorized Bot Control Panel</p>
                    </div>
                    <div class="content">
                        <p>Hello ${username},</p>
                        <p>Your email has been successfully verified!</p>

                        <div class="success-box">
                            <div class="icon">🎉</div>
                            <p>Your account is now active and ready to use.</p>
                        </div>

                        <div class="info-box">
                            <p><strong>What's next?</strong><br>You can now access the dashboard and manage your bots. If you have any questions or need assistance, feel free to reach out.</p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} <span class="brand">${fromName}</span>. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

export async function sendAccountFrozenEmail(email, username) {
    const transporter = getTransporter();

    const fromName = 'Dansthorized Bot Control Panel';
    const fromAddress = process.env.MAIL_USERNAME;
    const subject = 'Account Frozen - Action Required';

    const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: subject,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6; 
                        color: #000000; 
                        background-color: #ffffff;
                    }
                    .email-wrapper { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background-color: #ffffff;
                        border: 1px solid #e0e0e0;
                    }
                    .header { 
                        background-color: #f59e0b;
                        color: #ffffff; 
                        padding: 40px 30px; 
                        text-align: center; 
                    }
                    .header h1 {
                        font-size: 28px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                        color: #ffffff;
                    }
                    .header p {
                        font-size: 14px;
                        color: #ffffff;
                        font-weight: 300;
                    }
                    .content { 
                        background-color: #ffffff; 
                        padding: 40px 30px; 
                    }
                    .content p {
                        font-size: 16px;
                        color: #000000;
                        margin-bottom: 16px;
                    }
                    .content p:first-child {
                        font-size: 18px;
                        color: #000000;
                        font-weight: 500;
                        margin-bottom: 20px;
                    }
                    .warning-box {
                        background-color: #fef3c7;
                        border: 2px solid #f59e0b;
                        padding: 24px;
                        margin: 30px 0;
                        border-radius: 8px;
                        text-align: center;
                    }
                    .warning-box .icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                    }
                    .warning-box p {
                        margin: 0;
                        font-size: 18px;
                        color: #92400e;
                        font-weight: 600;
                    }
                    .info-box {
                        background-color: #ffffff;
                        padding: 20px;
                        margin: 24px 0;
                        border-radius: 8px;
                        border: 2px solid #f59e0b;
                        border-left: 4px solid #f59e0b;
                    }
                    .info-box p {
                        margin: 0;
                        font-size: 14px;
                        color: #000000;
                        line-height: 1.6;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 30px;
                        background-color: #f5f5f5;
                        border-top: 1px solid #e0e0e0;
                    }
                    .footer p {
                        font-size: 13px;
                        color: #666666;
                        margin: 4px 0;
                    }
                    .footer .brand {
                        color: #dc2626;
                        font-weight: 600;
                    }
                    @media only screen and (max-width: 600px) {
                        .content { padding: 30px 20px; }
                        .header { padding: 30px 20px; }
                        .header h1 { font-size: 24px; }
                    }
                </style>
            </head>
            <body style="background-color: #ffffff; padding: 20px;">
                <div class="email-wrapper">
                    <div class="header">
                        <h1>🔒 Account Frozen</h1>
                        <p>Dansthorized Bot Control Panel</p>
                    </div>
                    <div class="content">
                        <p>Hello ${username},</p>
                        <p>Your account has been frozen by an administrator.</p>

                        <div class="warning-box">
                            <div class="icon">⚠️</div>
                            <p>Your account access has been temporarily restricted.</p>
                        </div>

                        <div class="info-box">
                            <p><strong>What does this mean?</strong><br>You will not be able to log in or access your account until it is unfrozen by an administrator. If you believe this is an error or have questions, please contact an administrator.</p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} <span class="brand">${fromName}</span>. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

export async function sendAccountUnfrozenEmail(email, username) {
    const transporter = getTransporter();

    const fromName = 'Dansthorized Bot Control Panel';
    const fromAddress = process.env.MAIL_USERNAME;
    const subject = 'Account Unfrozen - Access Restored';

    const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: subject,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6; 
                        color: #000000; 
                        background-color: #ffffff;
                    }
                    .email-wrapper { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background-color: #ffffff;
                        border: 1px solid #e0e0e0;
                    }
                    .header { 
                        background-color: #10b981;
                        color: #ffffff; 
                        padding: 40px 30px; 
                        text-align: center; 
                    }
                    .header h1 {
                        font-size: 28px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                        color: #ffffff;
                    }
                    .header p {
                        font-size: 14px;
                        color: #ffffff;
                        font-weight: 300;
                    }
                    .content { 
                        background-color: #ffffff; 
                        padding: 40px 30px; 
                    }
                    .content p {
                        font-size: 16px;
                        color: #000000;
                        margin-bottom: 16px;
                    }
                    .content p:first-child {
                        font-size: 18px;
                        color: #000000;
                        font-weight: 500;
                        margin-bottom: 20px;
                    }
                    .success-box {
                        background-color: #d4edda;
                        border: 2px solid #10b981;
                        padding: 24px;
                        margin: 30px 0;
                        border-radius: 8px;
                        text-align: center;
                    }
                    .success-box .icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                    }
                    .success-box p {
                        margin: 0;
                        font-size: 18px;
                        color: #155724;
                        font-weight: 600;
                    }
                    .info-box {
                        background-color: #ffffff;
                        padding: 20px;
                        margin: 24px 0;
                        border-radius: 8px;
                        border: 2px solid #0066cc;
                        border-left: 4px solid #0066cc;
                    }
                    .info-box p {
                        margin: 0;
                        font-size: 14px;
                        color: #000000;
                        line-height: 1.6;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 30px;
                        background-color: #f5f5f5;
                        border-top: 1px solid #e0e0e0;
                    }
                    .footer p {
                        font-size: 13px;
                        color: #666666;
                        margin: 4px 0;
                    }
                    .footer .brand {
                        color: #dc2626;
                        font-weight: 600;
                    }
                    @media only screen and (max-width: 600px) {
                        .content { padding: 30px 20px; }
                        .header { padding: 30px 20px; }
                        .header h1 { font-size: 24px; }
                    }
                </style>
            </head>
            <body style="background-color: #ffffff; padding: 20px;">
                <div class="email-wrapper">
                    <div class="header">
                        <h1>✅ Account Unfrozen</h1>
                        <p>Dansthorized Bot Control Panel</p>
                    </div>
                    <div class="content">
                        <p>Hello ${username},</p>
                        <p>Your account has been unfrozen by an administrator.</p>

                        <div class="success-box">
                            <div class="icon">🎉</div>
                            <p>Your account access has been restored.</p>
                        </div>

                        <div class="info-box">
                            <p><strong>What's next?</strong><br>You can now log in and access your account normally. If you have any questions or need assistance, feel free to reach out.</p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} <span class="brand">${fromName}</span>. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

export async function sendAccountDeletedEmail(email, username) {
    const transporter = getTransporter();

    const fromName = 'Dansthorized Bot Control Panel';
    const fromAddress = process.env.MAIL_USERNAME;
    const subject = 'Account Deleted - Important Notice';

    const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: subject,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${subject}</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                        line-height: 1.6; 
                        color: #000000; 
                        background-color: #ffffff;
                    }
                    .email-wrapper { 
                        max-width: 600px; 
                        margin: 0 auto; 
                        background-color: #ffffff;
                        border: 1px solid #e0e0e0;
                    }
                    .header { 
                        background-color: #dc2626;
                        color: #ffffff; 
                        padding: 40px 30px; 
                        text-align: center; 
                    }
                    .header h1 {
                        font-size: 28px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        letter-spacing: -0.5px;
                        color: #ffffff;
                    }
                    .header p {
                        font-size: 14px;
                        color: #ffffff;
                        font-weight: 300;
                    }
                    .content { 
                        background-color: #ffffff; 
                        padding: 40px 30px; 
                    }
                    .content p {
                        font-size: 16px;
                        color: #000000;
                        margin-bottom: 16px;
                    }
                    .content p:first-child {
                        font-size: 18px;
                        color: #000000;
                        font-weight: 500;
                        margin-bottom: 20px;
                    }
                    .warning-box {
                        background-color: #fee2e2;
                        border: 2px solid #dc2626;
                        padding: 24px;
                        margin: 30px 0;
                        border-radius: 8px;
                        text-align: center;
                    }
                    .warning-box .icon {
                        font-size: 48px;
                        margin-bottom: 16px;
                    }
                    .warning-box p {
                        margin: 0;
                        font-size: 18px;
                        color: #991b1b;
                        font-weight: 600;
                    }
                    .info-box {
                        background-color: #ffffff;
                        padding: 20px;
                        margin: 24px 0;
                        border-radius: 8px;
                        border: 2px solid #dc2626;
                        border-left: 4px solid #dc2626;
                    }
                    .info-box p {
                        margin: 0;
                        font-size: 14px;
                        color: #000000;
                        line-height: 1.6;
                    }
                    .footer { 
                        text-align: center; 
                        padding: 30px;
                        background-color: #f5f5f5;
                        border-top: 1px solid #e0e0e0;
                    }
                    .footer p {
                        font-size: 13px;
                        color: #666666;
                        margin: 4px 0;
                    }
                    .footer .brand {
                        color: #dc2626;
                        font-weight: 600;
                    }
                    @media only screen and (max-width: 600px) {
                        .content { padding: 30px 20px; }
                        .header { padding: 30px 20px; }
                        .header h1 { font-size: 24px; }
                    }
                </style>
            </head>
            <body style="background-color: #ffffff; padding: 20px;">
                <div class="email-wrapper">
                    <div class="header">
                        <h1>🗑️ Account Deleted</h1>
                        <p>Dansthorized Bot Control Panel</p>
                    </div>
                    <div class="content">
                        <p>Hello ${username},</p>
                        <p>Your account has been deleted by an administrator.</p>

                        <div class="warning-box">
                            <div class="icon">⚠️</div>
                            <p>Your account and all associated data have been permanently removed.</p>
                        </div>

                        <div class="info-box">
                            <p><strong>Important:</strong><br>This action cannot be undone. If you believe this is an error or have questions, please contact an administrator immediately.</p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} <span class="brand">${fromName}</span>. All rights reserved.</p>
                        <p>This is an automated message, please do not reply to this email.</p>
                    </div>
                </div>
            </body>
            </html>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        throw new Error(`Failed to send email: ${error.message}`);
    }
}

export default { sendOTPEmail, sendVerificationSuccessEmail, sendAccountFrozenEmail, sendAccountUnfrozenEmail, sendAccountDeletedEmail };
