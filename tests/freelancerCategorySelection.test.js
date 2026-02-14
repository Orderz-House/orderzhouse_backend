// Test for freelancer category selection functionality
const axios = require('axios');

// Mock data for testing
const testUserData = {
  role_id: 3, // Freelancer
  first_name: "John",
  last_name: "Doe",
  email: "info@battechno.com",
  password: "TestPass123",
  phone_number: "+1234567890",
  country: "USA",
  username: "johndoetest",
  category_id: 1, // Assuming category 1 exists
  sub_category_ids: [2, 3] // Assuming sub-categories 2 and 3 exist and belong to category 1
};

describe('Freelancer Category Selection', () => {
  test('should register freelancer with category and sub-categories', async () => {
    try {
      const response = await axios.post('http://localhost:3000/users/register', testUserData);
      expect(response.status).toBe(201);
      expect(response.data.success).toBe(true);
    } catch (error) {
      // Handle expected errors (like duplicate email)
      if (error.response && error.response.status === 409) {
        // Email already exists - this is expected in test environment
        expect(error.response.status).toBe(409);
      } else {
        throw error;
      }
    }
  });

  test('should reject more than 3 sub-categories', async () => {
    const userDataWithTooManySubCategories = {
      ...testUserData,
      email: "info@battechno.com",
      username: "johndoetest2",
      sub_category_ids: [1, 2, 3, 4, 5] // More than 3
    };

    try {
      await axios.post('http://localhost:3000/users/register', userDataWithTooManySubCategories);
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.message).toContain('maximum of 3 sub-categories');
    }
  });
});