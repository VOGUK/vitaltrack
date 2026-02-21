# VitalTrack Health Monitor

VitalTrack is a secure, private, and mobile-friendly web application designed to track vital health statistics including **Blood Pressure**, **Pulse Rate**, and **Oxygen Levels (SpO2)**. 

Built as a **Progressive Web App (PWA)**, it can be installed directly onto Android and iOS home screens, providing a native-app experience while keeping your data under your own control.

## ✨ Features
- **Secure Authentication:** Server-side session management (no reliance on insecure local storage for auth).
- **NHS/WHO Guidelines:** Automated color-coding and status indicators based on health standards.
- **Historical Insights:** Interactive graphs and full history logs with edit/delete capabilities.
- **Smart Reports:** Generate professional PDF reports with dynamic charts or export raw data to CSV.
- **Data Sharing:** Securely share your data with a doctor or family member via unguessable 10-character access codes.
- **Privacy First:** Self-hosted SQLite database—your data never leaves your server.

## 🚀 Installation

### 1. Requirements
- A web host with **PHP 7.4+** support.
- An **SSL Certificate (HTTPS)** is strictly required for security and PWA features.

### 2. Setup
1. Download the repository files.
2. Upload all files to a folder on your web server.
3. Ensure the folder has write permissions (required for the app to create the `vitaltrack.db` file).
4. The `.htaccess` file is included to prevent unauthorized downloads of your database.

### 3. First Login
Upon first launch, a new database will be automatically created. Use the default credentials:
- **Username:** `admin`
- **Password:** `admin123`
- *Please change the admin password immediately in the Settings/Admin panel.*

## 🔒 Security Features
- **XSS Protection:** All user inputs are sanitized before rendering.
- **SQL Injection Prevention:** Uses PDO prepared statements for all database queries.
- **Session Security:** Cookies are set to `HttpOnly` and `SameSite: Strict`.
- **Database Protection:** Access to the SQLite file is blocked via `.htaccess`.

## 📱 Mobile Use
- **iOS:** Open in Safari, tap the 'Share' icon, and select **'Add to Home Screen'**.
- **Android:** Open in Chrome, tap the menu, and select **'Install App'**.

---
*Disclaimer: This application is for tracking purposes only and does not provide medical advice. Always consult with a healthcare professional for medical concerns.*
