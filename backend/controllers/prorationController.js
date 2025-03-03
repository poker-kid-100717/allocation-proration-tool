exports.calculateProration = (req, res) => {
    const { allocation_amount, investor_amounts } = req.body;
    if (!allocation_amount || !investor_amounts || investor_amounts.length === 0) {
        return res.status(400).json({ error: "Invalid input" });
    }

    let totalAverage = investor_amounts.reduce((sum, inv) => sum + inv.average_amount, 0);
    let results = {};

    investor_amounts.forEach(inv => {
        let proratedAmount = (allocation_amount * inv.average_amount) / totalAverage;
        results[inv.name] = Math.min(proratedAmount, inv.requested_amount);
    });

    res.json(results);
};
