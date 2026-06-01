// Placeholder for User model using a mock database
class User {
  constructor(id, username, email, password) {
    this.id = id;
    this.username = username;
    this.email = email;
    this.password = password;
  }

  static async findByEmail(email) {
    // Mock database query
    return email === "test@example.com" ? new User("123", "testuser", email, "password") : null;
  }

  static async create(userData) {
    // Mock database insert
    return new User("123", userData.username, userData.email, userData.password);
  }
}

module.exports = User;
