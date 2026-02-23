<?php
// Hide minor warnings/errors from breaking the JSON output
error_reporting(E_ALL & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', 0);

// Universally compatible session start
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Strict');
session_start();

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

$db_file = __DIR__ . '/vitaltrack.db';
$is_new_db = !file_exists($db_file);
$pdo = new PDO("sqlite:" . $db_file);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Auto-install database tables
if ($is_new_db) {
    // Added 'email TEXT' to the users table creation
    $pdo->exec("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT, name TEXT, dob TEXT, email TEXT, share_code TEXT)");
    $pdo->exec("CREATE TABLE readings (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, time TEXT, period TEXT, sys INTEGER, dia INTEGER, pulse INTEGER, oxygen INTEGER, notes TEXT)");
    
    $default_pass = password_hash('admin123', PASSWORD_DEFAULT);
    $pdo->exec("INSERT INTO users (username, password, role, name) VALUES ('admin', '$default_pass', 'admin', 'System Admin')");
} else {
    // Safe migration: Add 'email' column to existing databases automatically
    try {
        $pdo->exec("ALTER TABLE users ADD COLUMN email TEXT");
    } catch (PDOException $e) {
        // If the column already exists, SQLite throws an error. We silently ignore it.
    }
}

$action = $_GET['action'] ?? '';
$data = json_decode(file_get_contents("php://input"), true);
if (!$data) $data = []; // Prevent null errors

function requireAuth() {
    if (!isset($_SESSION['user_id'])) {
        echo json_encode(['success' => false, 'message' => 'Unauthorized session. Please log in again.']);
        exit;
    }
}

function requireAdmin() {
    requireAuth();
    if ($_SESSION['role'] !== 'admin') {
        echo json_encode(['success' => false, 'message' => 'Forbidden. Admin access required.']);
        exit;
    }
}

try {
    // --- 1. Authentication ---
    if ($action == 'login') {
        $username = $data['username'] ?? '';
        $password = $data['password'] ?? '';
        
        $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($user && password_verify($password, $user['password'])) {
            session_regenerate_id(true); 
            
            // Handle "Stay signed in"
            if (isset($data['remember']) && $data['remember'] == true) {
                setcookie(session_name(), session_id(), time() + (30 * 24 * 60 * 60), "/");
            }
            
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['role'] = $user['role'];
            
            unset($user['password']); 
            echo json_encode(['success' => true, 'user' => $user]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Incorrect username or password.']);
        }
    } 
    elseif ($action == 'check_auth') {
        if (isset($_SESSION['user_id'])) {
            // Added 'email' to the returned fields
            $stmt = $pdo->prepare("SELECT id, username, role, name, dob, email, share_code FROM users WHERE id = ?");
            $stmt->execute([$_SESSION['user_id']]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);
            if($user) {
                echo json_encode(['success' => true, 'user' => $user]);
            } else {
                echo json_encode(['success' => false]);
            }
        } else {
            echo json_encode(['success' => false]);
        }
    }
    elseif ($action == 'logout') {
        session_destroy();
        setcookie(session_name(), '', time() - 3600, "/"); 
        echo json_encode(['success' => true]);
    }
    
    // --- 2. Readings Management ---
    elseif ($action == 'save_reading') {
        requireAuth();
        $stmt = $pdo->prepare("INSERT INTO readings (user_id, date, time, period, sys, dia, pulse, oxygen, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$_SESSION['user_id'], $data['date'], $data['time'], $data['period'], $data['sys'], $data['dia'], $data['pulse'], $data['oxygen'], $data['notes']]);
        echo json_encode(['success' => true]);
    }
    elseif ($action == 'update_reading') {
        requireAuth();
        $stmt = $pdo->prepare("UPDATE readings SET date=?, time=?, period=?, sys=?, dia=?, pulse=?, oxygen=?, notes=? WHERE id=? AND user_id=?");
        $stmt->execute([$data['date'], $data['time'], $data['period'], $data['sys'], $data['dia'], $data['pulse'], $data['oxygen'], $data['notes'], $data['reading_id'], $_SESSION['user_id']]);
        echo json_encode(['success' => true]);
    }
    elseif ($action == 'delete_reading') {
        requireAuth();
        $stmt = $pdo->prepare("DELETE FROM readings WHERE id=? AND user_id=?");
        $stmt->execute([$data['reading_id'], $_SESSION['user_id']]);
        echo json_encode(['success' => true]);
    }
    elseif ($action == 'get_readings') {
        requireAuth();
        $stmt = $pdo->prepare("SELECT * FROM readings WHERE user_id = ? ORDER BY date DESC, time DESC");
        $stmt->execute([$_SESSION['user_id']]);
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
    }

    // --- 3. Profile & Sharing ---
    elseif ($action == 'update_profile') {
        requireAuth();
        // Added email to the update statement
        $stmt = $pdo->prepare("UPDATE users SET name = ?, dob = ?, email = ? WHERE id = ?");
        $stmt->execute([$data['name'], $data['dob'], $data['email'], $_SESSION['user_id']]);
        echo json_encode(['success' => true]);
    }
    elseif ($action == 'generate_share_code') {
        requireAuth();
        $code = strtoupper(substr(preg_replace('/[^a-zA-Z0-9]/', '', base64_encode(random_bytes(10))), 0, 10));
        $stmt = $pdo->prepare("UPDATE users SET share_code = ? WHERE id = ?");
        $stmt->execute([$code, $_SESSION['user_id']]);
        echo json_encode(['success' => true, 'share_code' => $code]);
    }
    elseif ($action == 'get_shared_data') {
        requireAuth();
        // Added email so the frontend knows the shared user's email too
        $stmt = $pdo->prepare("SELECT id, name, dob, email FROM users WHERE share_code = ?");
        $stmt->execute([$data['share_code']]);
        $shared_user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($shared_user) {
            $readings_stmt = $pdo->prepare("SELECT * FROM readings WHERE user_id = ? ORDER BY date DESC, time DESC");
            $readings_stmt->execute([$shared_user['id']]);
            echo json_encode(['success' => true, 'profile' => $shared_user, 'data' => $readings_stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid share code.']);
        }
    }

    // --- 4. Backup & Restore ---
    elseif ($action == 'backup_data') {
        requireAuth();
        $stmt = $pdo->prepare("SELECT * FROM readings WHERE user_id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $readings = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'backup' => $readings]);
    }
    elseif ($action == 'restore_data') {
        requireAuth();
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("INSERT INTO readings (user_id, date, time, period, sys, dia, pulse, oxygen, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($data['readings'] as $row) {
            $stmt->execute([$_SESSION['user_id'], $row['date'], $row['time'], $row['period'], $row['sys'], $row['dia'], $row['pulse'], $row['oxygen'], $row['notes']]);
        }
        $pdo->commit();
        echo json_encode(['success' => true]);
    }

    // --- 5. Admin Panel Logic ---
    elseif ($action == 'admin_action') {
        requireAdmin(); 

        $task = $data['task'];
        if ($task == 'get_users') {
            $stmt = $pdo->query("SELECT id, username, role, name, dob FROM users");
            echo json_encode(['success' => true, 'users' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        } 
        elseif ($task == 'add_user') {
            $hash = password_hash($data['new_password'], PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
            $stmt->execute([$data['new_username'], $hash, $data['new_role']]);
            echo json_encode(['success' => true]);
        }
        elseif ($task == 'delete_user') {
            $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
            $stmt->execute([$data['target_user_id']]);
            $stmt_readings = $pdo->prepare("DELETE FROM readings WHERE user_id = ?");
            $stmt_readings->execute([$data['target_user_id']]);
            echo json_encode(['success' => true]);
        }
        elseif ($task == 'reset_password') {
            $hash = password_hash($data['new_password'], PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
            $stmt->execute([$hash, $data['target_user_id']]);
            echo json_encode(['success' => true]);
        }
    }

    // --- 6. Send PDF via Email ---
    elseif ($action == 'email_report') {
        requireAuth();
        
        $pdf_data = $data['pdf_data'] ?? '';
        if (empty($pdf_data)) {
            echo json_encode(['success' => false, 'message' => 'No PDF data received.']);
            exit;
        }

        // Retrieve the logged-in user's email and name
        $stmt = $pdo->prepare("SELECT email, name FROM users WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (empty($user['email'])) {
            echo json_encode(['success' => false, 'message' => 'No email address found. Please update your profile settings.']);
            exit;
        }

        // Clean and decode the base64 string
        $pdf_decoded = base64_decode(preg_replace('#^data:application/\w+;base64,#i', '', $pdf_data));

        // Ensure PHPMailer files exist in the 'src' folder before attempting to load them
        if (!file_exists(__DIR__ . '/src/PHPMailer.php') || !file_exists(__DIR__ . '/src/Exception.php')) {
            echo json_encode(['success' => false, 'message' => 'PHPMailer library is missing. Please ensure the PHPMailer files are inside the "src" folder on your server.']);
            exit;
        }

        require_once __DIR__ . '/src/Exception.php';
        require_once __DIR__ . '/src/PHPMailer.php';

        $mail = new \PHPMailer\PHPMailer\PHPMailer(true);

        try {
            // Using the native PHP mail() engine automatically
            $host = $_SERVER['HTTP_HOST'] ?? 'vitaltrack.local';
            $mail->setFrom('no-reply@' . $host, 'VitalTrack App');
            $mail->addAddress($user['email'], $user['name']);
            
            $mail->Subject = 'Your Health Report';
            $mail->Body    = "Hello,\n\nPlease find your generated health report attached to this email.\n\nNote: This is an automated email.\n\nBest regards,\nVitalTrack App";
            
            // Attach the PDF from memory
            $mail->addStringAttachment($pdf_decoded, 'Patient_Report.pdf', 'base64', 'application/pdf');

            $mail->send();
            echo json_encode(['success' => true]);
            
        } catch (Exception $e) {
            echo json_encode(['success' => false, 'message' => 'Failed to send email. Mailer Error: ' . $mail->ErrorInfo]);
        }
    }

} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
?>
