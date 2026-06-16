import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)
DATABASE = 'budget.db'

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS wages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                amount REAL NOT NULL,
                source TEXT
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT,
                description TEXT
            )
        ''')
        conn.commit()

@app.route('/')
def index():
    db = get_db()
    wages = db.execute('SELECT * FROM wages ORDER BY date DESC').fetchall()
    expenses = db.execute('SELECT * FROM expenses ORDER BY date DESC').fetchall()
    total_income = db.execute('SELECT COALESCE(SUM(amount), 0) FROM wages').fetchone()[0]
    total_expenses = db.execute('SELECT COALESCE(SUM(amount), 0) FROM expenses').fetchone()[0]
    balance = total_income - total_expenses
    db.close()
    return render_template('index.html',
                           wages=wages,
                           expenses=expenses,
                           total_income=total_income,
                           total_expenses=total_expenses,
                           balance=balance)

@app.route('/add_wage', methods=['POST'])
def add_wage():
    date = request.form['date'] or datetime.today().strftime('%Y-%m-%d')
    amount = request.form['amount']
    source = request.form.get('source', '')
    db = get_db()
    db.execute('INSERT INTO wages (date, amount, source) VALUES (?, ?, ?)',
               (date, float(amount), source))
    db.commit()
    db.close()
    return redirect(url_for('index'))

@app.route('/add_expense', methods=['POST'])
def add_expense():
    date = request.form['date'] or datetime.today().strftime('%Y-%m-%d')
    amount = request.form['amount']
    category = request.form.get('category', '')
    description = request.form.get('description', '')
    db = get_db()
    db.execute('INSERT INTO expenses (date, amount, category, description) VALUES (?, ?, ?, ?)',
               (date, float(amount), category, description))
    db.commit()
    db.close()
    return redirect(url_for('index'))

@app.route('/delete_wage/<int:id>')
def delete_wage(id):
    db = get_db()
    db.execute('DELETE FROM wages WHERE id = ?', (id,))
    db.commit()
    db.close()
    return redirect(url_for('index'))

@app.route('/delete_expense/<int:id>')
def delete_expense(id):
    db = get_db()
    db.execute('DELETE FROM expenses WHERE id = ?', (id,))
    db.commit()
    db.close()
    return redirect(url_for('index'))

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
