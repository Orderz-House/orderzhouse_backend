/**
 * Minimal tests for POST /stripe/project-checkout-session logic.
 * Mocks Stripe so no real API key is needed.
 */

const mockCreate = jest.fn().mockResolvedValue({
  url: "https://checkout.stripe.com/c/pay/cs_test_123",
  id: "cs_test_123",
});

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockCreate,
      },
    },
  }));
});

describe("createProjectCheckoutSession", () => {
  let createProjectCheckoutSession;
  let req;
  let res;

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.CLIENT_URL = "http://localhost:3000";
    const stripeController = require("../controller/Stripe/stripe.js");
    createProjectCheckoutSession = stripeController.createProjectCheckoutSession;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      token: { userId: 42 },
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  test("returns 500 when STRIPE_SECRET_KEY is missing", async () => {
    const orig = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    await createProjectCheckoutSession(req, res);
    process.env.STRIPE_SECRET_KEY = orig;

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "STRIPE_SECRET_KEY is not configured",
      })
    );
  });

  test("for budget 45 JOD (fixed), creates session with unit_amount 45000 and returns session.url", async () => {
    req.body = {
      project_type: "fixed",
      budget: 45,
      title: "Test project",
      category_id: 2,
      description: "Desc",
    };

    await createProjectCheckoutSession(req, res);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.mode).toBe("payment");
    expect(createArg.currency).toBeUndefined();
    expect(createArg.line_items).toHaveLength(1);
    expect(createArg.line_items[0].price_data.currency).toBe("jod");
    expect(createArg.line_items[0].price_data.unit_amount).toBe(45000);
    expect(createArg.line_items[0].price_data.product_data.name).toBe("Project: Test project");
    expect(createArg.line_items[0].quantity).toBe(1);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      sessionId: "cs_test_123",
    });
  });

  test("returns 400 for invalid budget", async () => {
    req.body = {
      project_type: "fixed",
      budget: 0,
      title: "Test",
    };

    await createProjectCheckoutSession(req, res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("budget"),
      })
    );
  });
});
