import React, { useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
    const [allocation, setAllocation] = useState("");
    const [investors, setInvestors] = useState([{ name: "", requested_amount: "", average_amount: "" }]);
    const [results, setResults] = useState(null);

    const handleChange = (index, field, value) => {
        const updatedInvestors = [...investors];
        updatedInvestors[index][field] = value;
        setInvestors(updatedInvestors);
    };

    const addInvestor = () => {
        setInvestors([...investors, { name: "", requested_amount: "", average_amount: "" }]);
    };

    const handleSubmit = async () => {
        const payload = {
            allocation_amount: parseFloat(allocation),
            investor_amounts: investors.map(inv => ({
                name: inv.name,
                requested_amount: parseFloat(inv.requested_amount),
                average_amount: parseFloat(inv.average_amount)
            }))
        };

        try {
            const response = await axios.post("https://your-backend-url.vercel.app/api/prorate", payload);
            setResults(response.data);
        } catch (error) {
            console.error("Error calculating proration", error);
        }
    };

    return (
        <div className="container">
            <h1>Allocation Proration Tool</h1>
            <div>
                <label>Total Available Allocation</label>
                <input type="number" value={allocation} onChange={e => setAllocation(e.target.value)} />
            </div>
            <h2>Investor Breakdown</h2>
            {investors.map((inv, index) => (
                <div key={index}>
                    <input type="text" placeholder="Name" value={inv.name} onChange={e => handleChange(index, "name", e.target.value)} />
                    <input type="number" placeholder="Requested Amount" value={inv.requested_amount} onChange={e => handleChange(index, "requested_amount", e.target.value)} />
                    <input type="number" placeholder="Average Amount" value={inv.average_amount} onChange={e => handleChange(index, "average_amount", e.target.value)} />
                </div>
            ))}
            <button onClick={addInvestor}>Add Investor</button>
            <button onClick={handleSubmit}>Prorate</button>
            {results && (
                <div>
                    <h2>Results</h2>
                    <ul>
                        {Object.entries(results).map(([name, amount]) => (
                            <li key={name}>{name} - ${amount.toFixed(2)}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default App;
