DROP TABLE IF EXISTS borrowed_records;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    is_initial_admin INT DEFAULT 0
);

CREATE TABLE books (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    isbn VARCHAR(32) NOT NULL UNIQUE,
    quantity INT NOT NULL,
    available_quantity INT NOT NULL
);

CREATE TABLE borrowed_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    book_id INT NOT NULL,
    user_id INT NOT NULL,
    borrow_date DATETIME NOT NULL,
    due_date DATETIME NOT NULL,
    return_date DATETIME,
    fine_amount FLOAT DEFAULT 0.0,
    fine_paid INT DEFAULT 0,
    FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_books_isbn ON books (isbn);
CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_borrowed_user_id ON borrowed_records (user_id);
CREATE INDEX idx_borrowed_book_id ON borrowed_records (book_id);
