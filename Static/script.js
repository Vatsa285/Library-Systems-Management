
let currentUser = { logged_in: false, username: null, role: null };

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthStatus();
    // Form submit handlers (some might be conditionally available)
    const addBookForm = document.getElementById('addBookForm');
    if (addBookForm) addBookForm.addEventListener('submit', addBook);

    const adminAddUserForm = document.getElementById('adminAddUserForm');
    if (adminAddUserForm) adminAddUserForm.addEventListener('submit', adminAddUser);

    const borrowBookForm = document.getElementById('borrowBookForm');
    if (borrowBookForm) borrowBookForm.addEventListener('submit', borrowBook);

    const returnBookForm = document.getElementById('returnBookForm');
    if (returnBookForm) returnBookForm.addEventListener('submit', returnBook);

    const editBookForm = document.getElementById('editBookForm');
    if (editBookForm) editBookForm.addEventListener('submit', handleEditBookSubmit);

    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) changePasswordForm.addEventListener('submit', handleChangePassword);

    // Search functionality
    const searchBookInput = document.getElementById('searchBookInput');
    if (searchBookInput) {
        searchBookInput.addEventListener('keyup', (event) => {
            if (event.key === "Enter" || searchBookInput.value.length === 0 || searchBookInput.value.length > 2) {
                fetchBooks(searchBookInput.value);
            }
        });
    }

    // Initial data load (some might be conditional)
    fetchBooks();
    if (currentUser.logged_in) {
        fetchBorrowedRecords();
        if (currentUser.role === 'admin') {
            fetchUsers();
            fetchPendingUsers();
        }
    }
});

const API_BASE_URL = '/api';

function showMessage(message, type = 'success', areaId = 'messageArea') {
    const messageArea = document.getElementById(areaId);
    if (!messageArea) return;
    messageArea.textContent = message;
    messageArea.className = `message-area ${type}`;
    setTimeout(() => {
        messageArea.textContent = '';
        messageArea.className = 'message-area';
    }, 5000);
}

// --- Authentication ---
async function checkAuthStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/status`);
        currentUser = await response.json();
    } catch (error) {
        console.error('Error checking auth status:', error);
        currentUser = { logged_in: false, username: null, role: null };
    }
    updateUIVisibility();
    updateAuthNav();
}

function updateAuthNav() {
    const authNav = document.getElementById('authNav');
    if (!authNav) return;
    if (currentUser.logged_in) {
        authNav.innerHTML = `
            <span>Welcome, ${currentUser.username} (${currentUser.role})!</span>
            <button onclick="openChangePasswordModal()">Change Password</button>
            <button onclick="logoutUser()">Logout</button>
        `;
    } else {
        authNav.innerHTML = `
            <a href="/user-login">Login</a> | <a href="/request-account">Register</a>
        `;
    }
}

async function logoutUser() {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' });
        const result = await response.json();
        if (response.ok) {
            showMessage(result.message);
            currentUser = { logged_in: false, username: null, role: null };
            updateUIVisibility();
            updateAuthNav();
            window.location.href = '/user-login';
        } else {
            showMessage(result.error || 'Logout failed', 'error');
        }
    } catch (error) {
        showMessage('Network error during logout.', 'error');
    }
}

// --- Password Change Functions ---
function openChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'flex';
}
function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'none';
    document.getElementById('changePasswordForm').reset();
}

async function handleChangePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
        showMessage('New passwords do not match!', 'error');
        return;
    }
    if (newPassword.length < 6) {
        showMessage('New password must be at least 6 characters long!', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                current_password: currentPassword, 
                new_password: newPassword 
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Password changed successfully!');
        closeChangePasswordModal();
    } catch (error) {
        showMessage('Failed to change password: ' + error.message, 'error');
    }
}

function updateUIVisibility() {
    const adminSection = document.getElementById('adminSection');
    const memberSection = document.getElementById('memberSection');
    const borrowedListSection = document.getElementById('borrowedListSection');
    const adminBorrowedLabel = document.getElementById('adminBorrowedLabel');

    if (adminSection) adminSection.style.display = currentUser.role === 'admin' ? 'block' : 'none';
    if (memberSection) memberSection.style.display = (currentUser.logged_in && currentUser.role !== 'admin') ? 'block' : 'none';
    if (borrowedListSection) borrowedListSection.style.display = currentUser.logged_in ? 'block' : 'none';
    if (adminBorrowedLabel) adminBorrowedLabel.style.display = currentUser.role === 'admin' ? 'inline' : 'none';

    // Refresh lists that depend on auth state
    if (currentUser.logged_in) fetchBorrowedRecords();
    if (currentUser.role === 'admin') {
        fetchUsers();
        fetchPendingUsers();
    }
}

// --- User Management (Admin) ---
async function adminAddUser(event) {
    event.preventDefault();
    const username = document.getElementById('adminAddUsername').value;
    const password = document.getElementById('adminAddPassword').value;
    const role = document.getElementById('adminAddUserRole').value;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'User added successfully!');
        fetchUsers();
        document.getElementById('adminAddUserForm').reset();
    } catch (error) {
        showMessage('Failed to add user: ' + error.message, 'error');
    }
}

async function fetchPendingUsers() {
    if (currentUser.role !== 'admin') return;
    try {
        const response = await fetch('/api/users/pending');
        if (!response.ok) throw new Error('Failed to fetch pending users');
        const users = await response.json();
        displayPendingUsers(users);
    } catch (error) {
        showMessage('Failed to load pending users. ' + error.message, 'error');
    }
}

function displayPendingUsers(users) {
    const pendingDiv = document.getElementById('pendingUserList');
    if (!pendingDiv) return;
    if (users.length === 0) {
        pendingDiv.innerHTML = '<p>No pending users.</p>';
        return;
    }
    let html = '<table><thead><tr><th>Username</th><th>Actions</th></tr></thead><tbody>';
    users.forEach(user => {
        html += `<tr>
            <td>${user.username}</td>
            <td>
                <button onclick="approveUser(${user.id})" class="action-button approve-btn">Approve</button>
                <button onclick="rejectUser(${user.id})" class="action-button reject-btn">Reject</button>
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    pendingDiv.innerHTML = html;
}

async function approveUser(userId) {
    if (!confirm('Approve this user?')) return;
    try {
        const response = await fetch(`/api/users/${userId}/approve`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to approve user');
        showMessage(result.message);
        fetchPendingUsers();
        fetchUsers();
    } catch (error) {
        showMessage('Failed to approve user: ' + error.message, 'error');
    }
}

async function rejectUser(userId) {
    if (!confirm('Reject this user?')) return;
    try {
        const response = await fetch(`/api/users/${userId}/reject`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to reject user');
        showMessage(result.message);
        fetchPendingUsers();
        fetchUsers();
    } catch (error) {
        showMessage('Failed to reject user: ' + error.message, 'error');
    }
}

async function fetchUsers() {
    if (currentUser.role !== 'admin') return;
    try {
        const response = await fetch(`${API_BASE_URL}/users`);
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.warn("Unauthorized to fetch users or not logged in."); return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const users = await response.json();
        displayUsers(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        showMessage('Failed to load users. ' + error.message, 'error');
    }
}

function displayUsers(users) {
    const userListDiv = document.getElementById('userList');
    if (!userListDiv) return;
    if (users.length === 0) {
        userListDiv.innerHTML = '<p>No users found.</p>';
        return;
    }
    let tableHtml = `
        <table>
            <thead><tr><th>Username</th><th>Role</th><th>ID</th><th>Actions</th></tr></thead>
            <tbody>`;
    users.forEach(user => {
        tableHtml += `<tr>
            <td>${user.username}</td>
            <td>${user.role}</td>
            <td>${user.id}</td>
            <td>
                ${!user.is_initial_admin ? 
                    `<button onclick="deleteUser(${user.id}, '${user.username}')" class="action-button delete-btn">Delete</button>` : 
                    '<span style="color: #999; font-style: italic;">Protected</span>'
                }
            </td>
        </tr>`;
    });
    tableHtml += '</tbody></table>';
    userListDiv.innerHTML = tableHtml;
}

async function deleteUser(userId, username) {
    // First check if this is the initial admin
    try {
        const userResponse = await fetch(`${API_BASE_URL}/users/${userId}`);
        const userData = await userResponse.json();
        if (userData.is_initial_admin) {
            showMessage('Cannot delete the initial admin user.', 'error');
            return;
        }
    } catch (error) {
        console.error('Error checking user details:', error);
    }
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone and will also delete all their borrowed records.`)) return;
    try {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/delete`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'User deleted successfully!');
        fetchUsers();
        fetchBorrowedRecords(); // Refresh borrowed records as they might be affected
    } catch (error) {
        showMessage('Failed to delete user: ' + error.message, 'error');
    }
}

// --- Book Functions ---
async function fetchBooks(searchTerm = '') {
    const url = searchTerm ? `${API_BASE_URL}/books/search?q=${encodeURIComponent(searchTerm)}` : `${API_BASE_URL}/books`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const books = await response.json();
        displayBooks(books);
    } catch (error) {
        console.error('Error fetching books:', error);
        showMessage('Failed to load books. ' + error.message, 'error');
    }
}

function displayBooks(books) {
    const bookListDiv = document.getElementById('bookList');
    if (!bookListDiv) return;
    if (books.length === 0) {
        bookListDiv.innerHTML = '<p>No books found.</p>';
        return;
    }
    let tableHtml = `
        <table>
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Author</th>
                    <th>ISBN</th>
                    <th>Total</th>
                    <th>Available</th>
                    ${currentUser.role === 'admin' ? '<th>Actions</th>' : ''}
                </tr>
            </thead>
            <tbody>
    `;
    books.forEach(book => {
        tableHtml += `
            <tr>
                <td>${book.title}</td>
                <td>${book.author}</td>
                <td>${book.isbn}</td>
                <td>${book.quantity}</td>
                <td>${book.available_quantity}</td>
                ${currentUser.role === 'admin' ? `<td>
                    <button onclick="openEditModal(${book.id}, '${book.title.replace(/'/g, "\\'")}', '${book.author.replace(/'/g, "\\'")}', '${book.isbn}', ${book.quantity})" class="action-button edit-btn">Edit</button>
                    <button onclick="deleteBook(${book.id})" class="action-button delete-btn">Delete</button>
                </td>` : ''}
            </tr>
        `;
    });
    tableHtml += '</tbody></table>';
    bookListDiv.innerHTML = tableHtml;
}

async function addBook(event) {
    event.preventDefault();
    const title = document.getElementById('bookTitle').value;
    const author = document.getElementById('bookAuthor').value;
    const isbn = document.getElementById('bookIsbn').value;
    const quantity = document.getElementById('bookQuantity').value;

    try {
        const response = await fetch(`${API_BASE_URL}/books`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, author, isbn, quantity: parseInt(quantity) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Book added successfully!');
        fetchBooks();
        document.getElementById('addBookForm').reset();
    } catch (error) {
        showMessage('Failed to add book: ' + error.message, 'error');
    }
}

async function deleteBook(bookId) {
    if (!confirm('Are you sure you want to delete this book? This may also delete related borrow records.')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/books/${bookId}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Book deleted successfully!');
        fetchBooks(); // Refresh list
        fetchBorrowedRecords(); // Borrow records might be affected by CASCADE
    } catch (error) {
        showMessage('Failed to delete book: ' + error.message, 'error');
    }
}

// --- Edit Book Modal ---
function openEditModal(id, title, author, isbn, quantity) {
    document.getElementById('editBookId').value = id;
    document.getElementById('editBookTitle').value = title;
    document.getElementById('editBookAuthor').value = author;
    document.getElementById('editBookIsbn').value = isbn;
    document.getElementById('editBookQuantity').value = quantity;
    document.getElementById('editBookModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editBookModal').style.display = 'none';
}

async function handleEditBookSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('editBookId').value;
    const title = document.getElementById('editBookTitle').value;
    const author = document.getElementById('editBookAuthor').value;
    const isbn = document.getElementById('editBookIsbn').value;
    const quantity = document.getElementById('editBookQuantity').value;

    try {
        const response = await fetch(`${API_BASE_URL}/books/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, author, isbn, quantity: parseInt(quantity) })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Book updated successfully!');
        fetchBooks();
        closeEditModal();
    } catch (error) {
        showMessage('Failed to update book: ' + error.message, 'error');
    }
}

// --- Borrowing/Returning Functions ---
async function borrowBook(event) {
    event.preventDefault();
    const isbn = document.getElementById('borrowBookIsbn').value;
    try {
        const response = await fetch('/api/borrow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_isbn: isbn })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Failed to borrow book.");
        showMessage(result.message || 'Book borrowed successfully!');
        fetchBorrowedRecords();
    } catch (err) {
        showMessage('Failed to borrow book: ' + err.message, 'error');
    }
}
async function returnBook(event) {
    event.preventDefault();
    const bookIsbn = document.getElementById('returnBookIsbn').value;
    try {
        const response = await fetch(`/api/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_isbn: bookIsbn })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Book returned successfully!');
        fetchBooks(); // Refresh available books
        fetchBorrowedRecords(); // Refresh borrowed records
        document.getElementById('returnBookForm').reset();
    } catch (error) {
        showMessage('Failed to return book: ' + error.message, 'error');
    }
}
async function adminReturnBook(recordId) {
    if (!confirm('Are you sure you want to mark this book as returned?')) return;
    try {
        const response = await fetch(`/api/borrowed/${recordId}/admin-return`, { 
            method: 'POST',
            credentials: 'include', // IMPORTANT for session/cookies
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Book marked as returned!');
        fetchBooks();
        fetchBorrowedRecords();
    } catch (error) {
        showMessage('Failed to mark book as returned: ' + error.message, 'error');
    }
}
// --- Borrowed Records Functions ---
async function fetchBorrowedRecords() {
    if (!currentUser.logged_in) return;
    try {
        const endpoint = `${API_BASE_URL}/borrowed`;
        const response = await fetch(endpoint);
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.warn("Unauthorized to fetch borrowed records or not logged in.");
                return;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const records = await response.json();
        displayBorrowedRecords(records);
    } catch (error) {
        console.error('Error fetching borrowed records:', error);
        showMessage('Failed to load borrowed records. ' + error.message, 'error');
    }
}

function displayBorrowedRecords(records) {
    const recordsDiv = document.getElementById('borrowedRecordsList');
    if (!recordsDiv) return;
    if (records.length === 0) {
        recordsDiv.innerHTML = '<p>No borrowed records found.</p>';
        return;
    }
    let tableHtml = `
        <table>
            <thead>
                <tr>
                    ${currentUser.role === 'admin' ? '<th>User</th>' : ''}
                    <th>Book Title</th>
                    <th>ISBN</th>
                    <th>Borrow Date</th>
                    <th>Due Date</th>
                    <th>Return Date</th>
                    <th>Status</th>
                    <th>Fine</th>
                    ${currentUser.role === 'admin' ? '<th>Actions</th>' : ''}
                </tr>
            </thead>
            <tbody>
    `;
    records.forEach(record => {
        const isOverdue = !record.return_date && new Date(record.due_date) < new Date();
        const rowClass = isOverdue ? 'overdue' : '';
        const fineStatus = record.fine_amount > 0 ? 
            (record.fine_paid ? 'fine-paid' : 'fine-unpaid') : '';
        tableHtml += `
            <tr class="${rowClass}">
                ${currentUser.role === 'admin' ? `<td>${record.username || 'N/A'}</td>` : ''}
                <td>${record.book_title}</td>
                <td>${record.book_isbn}</td>
                <td>${new Date(record.borrow_date).toLocaleDateString()}</td>
                <td>${new Date(record.due_date).toLocaleDateString()}</td>
                <td>${record.return_date ? new Date(record.return_date).toLocaleDateString() : 'Not returned'}</td>
                <td>${record.return_date ? 'Returned' : (isOverdue ? 'Overdue' : 'Borrowed')}</td>
                <td class="${fineStatus}">
                    ${record.fine_amount > 0 ? 
                        `$${record.fine_amount.toFixed(2)} ${record.fine_paid ? '(Paid)' : '(Unpaid)'}` : 
                        'No fine'
                    }
                </td>
                ${currentUser.role === 'admin' ? `<td>
    ${!record.return_date ? 
        `<button onclick="adminReturnBook(${record.record_id})" class="action-button">Mark Returned</button>` 
        : ''
    }
    ${record.fine_amount > 0 && !record.fine_paid ? 
        `<button onclick="openFinePaymentModal(${record.id}, ${record.fine_amount})" class="action-button fine-btn">Mark Fine Paid</button>` 
        : ''
    }
</td>` : ''}
            </tr>
        `;
    });
    tableHtml += '</tbody></table>';
    recordsDiv.innerHTML = tableHtml;
}

// --- Fine Payment Functions (Admin Only) ---
function openFinePaymentModal(recordId, fineAmount) {
    document.getElementById('fineRecordId').value = recordId;
    document.getElementById('fineAmountDisplay').textContent = fineAmount.toFixed(2);
    document.getElementById('finePaymentConfirm').checked = false;
    document.getElementById('finePaymentModal').style.display = 'flex';
}

function closeFinePaymentModal() {
    document.getElementById('finePaymentModal').style.display = 'none';
    document.getElementById('finePaymentConfirm').checked = false;
}

async function confirmFinePayment() {
    const recordId = document.getElementById('fineRecordId').value;
    const isConfirmed = document.getElementById('finePaymentConfirm').checked;
    if (!isConfirmed) {
        showMessage('Please confirm that the fine has been paid.', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/borrowed-records/${recordId}/pay-fine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP error! status: ${response.status}`);
        showMessage(result.message || 'Fine marked as paid successfully!');
        fetchBorrowedRecords(); // Refresh the records
        closeFinePaymentModal();
    } catch (error) {
        showMessage('Failed to mark fine as paid: ' + error.message, 'error');
    }
}
