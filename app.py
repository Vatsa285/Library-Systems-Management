import os
import pymysql
from flask import Flask, request, jsonify, session, redirect, url_for, render_template, g
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from functools import wraps
from flask_cors import CORS

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "BMSce")  

CORS(app, supports_credentials=True, origins=[
    "http://localhost:5000",
    "http://localhost:3000"
])
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False  
)

MYSQL_CONFIG = {
    "host": os.environ.get("MYSQL_HOST", "localhost"),
    "user": os.environ.get("MYSQL_USER", "youruser"),
    "password": os.environ.get("MYSQL_PASSWORD", "yourpassword"),
    "database": os.environ.get("MYSQL_DATABASE", "library"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True
}
SCHEMA = 'schema.sql'
FINE_PER_DAY = 0.5

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = pymysql.connect(**MYSQL_CONFIG)
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        with db.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE username = %s", ("admin",))
            if not cursor.fetchone():
                cursor.execute(
                    "INSERT INTO users (username, password_hash, role, status, is_initial_admin) VALUES (%s, %s, 'admin', 'active', 1)",
                    ('admin', generate_password_hash('admin123'))
                )

def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required"}), 401
            else:
                return redirect(url_for('user_login'))
        return f(*args, **kwargs)
    return wrapper

def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get('role') != 'admin':
            return jsonify({"error": "Admin only"}), 403
        return f(*args, **kwargs)
    return wrapper

@app.route('/')
def home():
    return redirect(url_for('user_login'))

@app.route('/user-login')
def user_login():
    return render_template('user_login.html')

@app.route('/admin-login')
def admin_login():
    return render_template('admin_login.html')

@app.route('/request-account')
def request_account():
    return render_template('request_account.html')

@app.route('/index')
@login_required
def index():
    return render_template('index.html')

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(force=True, silent=True)
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Missing credentials"}), 400
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE username = %s", (data['username'],))
        user = cursor.fetchone()
    if user and check_password_hash(user['password_hash'], data['password']):
        if user['status'] != 'active':
            return jsonify({"error": "Account not approved by admin."}), 403
        session.clear()
        session['user_id'] = user['id']
        session['username'] = user['username']
        session['role'] = user['role']
        return jsonify({"message": "Login successful", "role": user['role'], "username": user['username']})
    return jsonify({"error": "Invalid credentials"}), 401

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(force=True, silent=True)
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({"error": "Missing credentials"}), 400
    username = data['username']
    password = data['password']
    role = data.get('role', 'member')
    status = 'active' if session.get('role') == 'admin' else 'pending'
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
        if cursor.fetchone():
            return jsonify({"error": "Username exists"}), 409
        cursor.execute("INSERT INTO users (username, password_hash, role, status) VALUES (%s, %s, %s, %s)",
                       (username, generate_password_hash(password), role, status))
    return jsonify({"message": "Account requested. Awaiting admin approval." if status == 'pending' else "User added and approved."})

@app.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})

@app.route('/api/auth/status')
def auth_status():
    if 'user_id' in session:
        return jsonify({"logged_in": True, "username": session['username'], "role": session['role']})
    return jsonify({"logged_in": False})

@app.route('/api/auth/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json(force=True, silent=True)
    if not data or 'current_password' not in data or 'new_password' not in data:
        return jsonify({"error": "Missing password fields"}), 400
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM users WHERE id = %s", (session['user_id'],))
        user = cursor.fetchone()
        if not user or not check_password_hash(user['password_hash'], data['current_password']):
            return jsonify({"error": "Current password is incorrect"}), 400
        cursor.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                       (generate_password_hash(data['new_password']), session['user_id']))
    return jsonify({"message": "Password changed successfully!"})

@app.route('/api/users/pending', methods=['GET'])
@admin_required
def list_pending():
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id, username FROM users WHERE status = 'pending'")
        users = cursor.fetchall()
    return jsonify(users)

@app.route('/api/users/<int:user_id>/approve', methods=['POST'])
@admin_required
def approve_user(user_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("UPDATE users SET status = 'active' WHERE id = %s", (user_id,))
    return jsonify({"message": "User approved"})

@app.route('/api/users/<int:user_id>/reject', methods=['POST'])
@admin_required
def reject_user(user_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("UPDATE users SET status = 'rejected' WHERE id = %s", (user_id,))
    return jsonify({"message": "User rejected"})

@app.route('/api/users/<int:user_id>', methods=['GET'])
@admin_required
def get_user_by_id(user_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id, username, role FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(user)

@app.route('/api/users/<int:user_id>/delete', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id, username FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        if user and user['username'] == 'admin':
            return jsonify({"error": "Cannot delete the initial admin user."}), 403
        cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
    return jsonify({"message": "User deleted successfully!"})

@app.route('/api/books', methods=['GET'])
@login_required
def get_books():
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM books")
        books = cursor.fetchall()
    return jsonify(books)

@app.route('/api/books', methods=['POST'])
@admin_required
def add_book():
    data = request.get_json(force=True, silent=True)
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute(
            "INSERT INTO books (title, author, isbn, quantity, available_quantity) VALUES (%s, %s, %s, %s, %s)",
            (data['title'], data['author'], data['isbn'], data['quantity'], data['quantity'])
        )
    return jsonify({"message": "Book added successfully!"})

@app.route('/api/books/<int:book_id>', methods=['PUT'])
@admin_required
def edit_book(book_id):
    data = request.get_json(force=True, silent=True)
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute(
            "UPDATE books SET title=%s, author=%s, isbn=%s, quantity=%s, available_quantity=%s WHERE id=%s",
            (data['title'], data['author'], data['isbn'], data['quantity'], data['quantity'], book_id)
        )
    return jsonify({"message": "Book updated successfully!"})

@app.route('/api/books/<int:book_id>', methods=['DELETE'])
@admin_required
def delete_book(book_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("DELETE FROM books WHERE id=%s", (book_id,))
    return jsonify({"message": "Book deleted successfully!"})

@app.route('/api/books/search')
@login_required
def search_books():
    q = request.args.get('q', '')
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute(
            "SELECT * FROM books WHERE title LIKE %s OR author LIKE %s OR isbn LIKE %s",
            (f'%{q}%', f'%{q}%', f'%{q}%')
        )
        books = cursor.fetchall()
    return jsonify(books)

@app.route('/api/borrow', methods=['POST'])
@login_required
def borrow_book():
    data = request.get_json(force=True, silent=True)
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM books WHERE isbn=%s", (data['book_isbn'],))
        book = cursor.fetchone()
        if not book or book['available_quantity'] < 1:
            return jsonify({"error": "Book not available"}), 400
        due_date = (datetime.now() + timedelta(days=0)).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            "INSERT INTO borrowed_records (book_id, user_id, borrow_date, due_date) VALUES (%s, %s, %s, %s)",
            (book['id'], session['user_id'], datetime.now().strftime("%Y-%m-%d %H:%M:%S"), due_date)
        )
        cursor.execute("UPDATE books SET available_quantity = available_quantity - 1 WHERE id=%s", (book['id'],))
    return jsonify({"message": "Book borrowed successfully!"})

@app.route('/api/return', methods=['POST'])
@login_required
def return_book():
    data = request.get_json(force=True, silent=True)
    if not data or 'book_isbn' not in data:
        return jsonify({"error": "Missing book ISBN"}), 400
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM books WHERE isbn=%s", (data['book_isbn'],))
        book = cursor.fetchone()
        if not book:
            return jsonify({"error": "Book not found"}), 404
        cursor.execute(
            "SELECT * FROM borrowed_records WHERE book_id=%s AND user_id=%s AND return_date IS NULL",
            (book['id'], session['user_id'])
        )
        record = cursor.fetchone()
        if not record:
            return jsonify({"error": "No active borrow record found"}), 404
        return_date = datetime.now()
        due_date = record['due_date']
        if isinstance(due_date, str):
            due_date = datetime.strptime(due_date.split('.')[0], "%Y-%m-%d %H:%M:%S")
        fine = max(0, (return_date - due_date).days) * FINE_PER_DAY
        cursor.execute(
            "UPDATE borrowed_records SET return_date=%s, fine_amount=%s WHERE id=%s",
            (return_date.strftime("%Y-%m-%d %H:%M:%S"), fine, record['id'])
        )
        cursor.execute("UPDATE books SET available_quantity = available_quantity + 1 WHERE id=%s", (book['id'],))
    return jsonify({"message": "Book returned successfully!", "fine": fine})

@app.route('/api/borrowed', methods=['GET'])
@login_required
def get_borrowed():
    db = get_db()
    with db.cursor() as cursor:
        if session.get('role') == 'admin':
            cursor.execute(
                """
                SELECT 
                    br.id as record_id, 
                    b.title as book_title, 
                    b.isbn as book_isbn,
                    u.username as username,
                    br.borrow_date,
                    br.due_date,
                    br.return_date,
                    br.fine_amount,
                    br.fine_paid
                FROM borrowed_records br 
                JOIN books b ON br.book_id = b.id 
                JOIN users u ON br.user_id = u.id
                ORDER BY br.borrow_date DESC
                """
            )
            records = cursor.fetchall()
        else:
            cursor.execute(
                """
                SELECT 
                    br.id as record_id,
                    b.title as book_title,
                    b.isbn as book_isbn,
                    br.borrow_date,
                    br.due_date,
                    br.return_date,
                    br.fine_amount,
                    br.fine_paid
                FROM borrowed_records br 
                JOIN books b ON br.book_id = b.id 
                WHERE br.user_id = %s
                ORDER BY br.borrow_date DESC
                """,
                (session['user_id'],)
            )
            records = cursor.fetchall()
    return jsonify(records)

@app.route('/api/borrowed/<int:record_id>/pay-fine', methods=['POST'])
@admin_required
def pay_fine(record_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("UPDATE borrowed_records SET fine_paid=1 WHERE id=%s", (record_id,))
    return jsonify({"message": "Fine marked as paid!"})

@app.route('/api/borrowed/<int:record_id>/admin-return', methods=['POST'])
@admin_required
def admin_return(record_id):
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT * FROM borrowed_records WHERE id = %s", (record_id,))
        record = cursor.fetchone()
        if not record or record['return_date']:
            return jsonify({"error": "Invalid or already returned"}), 400
        return_date = datetime.now()
        due_date = record['due_date']
        if isinstance(due_date, str):
            due_date = datetime.strptime(due_date.split('.')[0], "%Y-%m-%d %H:%M:%S")
        fine = max(0, (return_date - due_date).days) * FINE_PER_DAY
        cursor.execute(
            "UPDATE borrowed_records SET return_date = %s, fine_amount = %s WHERE id = %s",
            (return_date.strftime("%Y-%m-%d %H:%M:%S"), fine, record_id)
        )
        cursor.execute(
            "UPDATE books SET available_quantity = available_quantity + 1 WHERE id = %s",
            (record['book_id'],)
        )
    return jsonify({"message": "Returned", "fine": fine})

@app.route('/api/users', methods=['GET'])
@admin_required
def get_users():
    db = get_db()
    with db.cursor() as cursor:
        cursor.execute("SELECT id, username, role FROM users")
        users = cursor.fetchall()
    return jsonify(users)

@app.route('/reset-admin', methods=['GET'])
def reset_admin():
    db = get_db()
    pw_hash = generate_password_hash('admin123')
    with db.cursor() as cursor:
        cursor.execute("UPDATE users SET password_hash = %s WHERE username = 'admin'", (pw_hash,))
    return "Admin password reset to admin123"

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)