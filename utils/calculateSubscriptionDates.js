export const calculateSubscriptionDates = (planType, duration) => {
  const start = new Date();
  const end = new Date(start);

  switch (planType) {
    case "daily":
      end.setDate(end.getDate() + duration);
      break;
    case "monthly":
      end.setMonth(end.getMonth() + duration);
      break;
    case "yearly":
      end.setFullYear(end.getFullYear() + duration);
      break;
    default:
      throw new Error(`Invalid plan type: ${planType}`);
  }

  return {
    start_date: start.toISOString().split("T")[0],
    end_date: end.toISOString().split("T")[0],
  };
};
