# 🧪 Training Mode - Complete Setup Guide

## ✅ What's Been Built

### **Phase 1: Infrastructure** (COMPLETE)

1. **Mock Prop Generator** (`lib/mock-prop-generator.js`)
   - Generates "shadow props" using statistical models
   - Uses Poisson distribution for counting stats
   - Calculates synthetic odds from probabilities
   - Zero API costs (uses free data)

2. **Database Model** (`MockPropValidation`)
   - Tracks mock predictions
   - Stores expected vs actual values
   - Calculates accuracy by prop type, confidence, sport

3. **API Endpoints**
   - `POST /api/training/generate` - Generate mock props for today's games
   - `POST /api/training/validate` - Validate completed mock props
   - `GET /api/training/stats` - Get training statistics

4. **Database Schema** ✅ PUSHED
   - `MockPropValidation` table created
   - Prisma client regenerated

---

## 🎯 Next Steps: Add UI (5 minutes)

### **Step 1: Add Training Tab Button to Validation Page**

The validation page needs a tab switcher. Here's what to add:

**Location:** `app/validation/page.js`

**Add this right after the header** (around line 57, after the buttons):

```jsx
{/* Tab Switcher */}
<div className="flex justify-center gap-4 mb-8">
  <Link
    href="/validation"
    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
  >
    📊 Real Props
  </Link>
  <Link
    href="/validation/training"
    className="px-6 py-3 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg font-medium"
  >
    🧪 Training Mode
  </Link>
</div>
```

### **Step 2: Create Training Page**

**Create file:** `app/validation/training/page.js`

```javascript
// Training Mode - Mock Prop Analytics
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function TrainingModePage() {
  // Fetch training stats
  const response = await fetch('http://localhost:3000/api/training/stats', {
    cache: 'no-store'
  })
  const data = await response.json()
  
  const { summary, propTypeAccuracy, confidenceStats, recentPredictions } = data

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8 text-center">
          <Link 
            href="/validation"
            className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500 mb-4"
          >
            ← Back to Validation
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">
            🧪 Training Mode
          </h1>
          <p className="text-lg text-gray-600 mt-2">
            ML training using free APIs - Zero cost prop validation
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex justify-center gap-4 mb-8">
          <Link
            href="/validation"
            className="px-6 py-3 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-lg font-medium"
          >
            📊 Real Props
          </Link>
          <Link
            href="/validation/training"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium"
          >
            🧪 Training Mode
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Mock Props Generated</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{summary?.totalProps || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Training samples</div>
          </div>
          
          <div className="bg-green-50 rounded-lg shadow p-6 border-2 border-green-200">
            <div className="text-sm font-medium text-green-700">Training Accuracy</div>
            <div className="mt-2 text-3xl font-bold text-green-600">
              {summary?.accuracy ? `${summary.accuracy.toFixed(1)}%` : 'N/A'}
            </div>
            <div className="text-xs text-green-600 mt-1">
              {summary?.correctProps || 0} correct / {summary?.completedProps || 0} validated
            </div>
          </div>
          
          <div className="bg-blue-50 rounded-lg shadow p-6 border-2 border-blue-200">
            <div className="text-sm font-medium text-blue-700">Pending Validation</div>
            <div className="mt-2 text-3xl font-bold text-blue-600">
              {summary?.pendingProps || 0}
            </div>
            <div className="text-xs text-blue-600 mt-1">Awaiting game completion</div>
          </div>
          
          <div className="bg-purple-50 rounded-lg shadow p-6 border-2 border-purple-200">
            <div className="text-sm font-medium text-purple-700">Cost Saved</div>
            <div className="mt-2 text-3xl font-bold text-purple-600">
              {summary?.costSaved || '$0.00'}
            </div>
            <div className="text-xs text-purple-600 mt-1">vs paid API calls</div>
          </div>
        </div>

        {/* Accuracy by Prop Type */}
        {propTypeAccuracy && propTypeAccuracy.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Accuracy by Prop Type</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Prop Type
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Total
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Accuracy
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Recommendation
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {propTypeAccuracy.map((prop) => (
                    <tr key={prop.propType}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {prop.propType.replace(/_/g, ' ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-500">
                        {prop.total}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                        <span className={`font-semibold ${
                          parseFloat(prop.accuracy) >= 55 ? 'text-green-600' : 
                          parseFloat(prop.accuracy) >= 50 ? 'text-blue-600' : 
                          'text-red-600'
                        }`}>
                          {prop.accuracy}%
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                        {parseFloat(prop.accuracy) >= 55 ? (
                          <span className="text-green-600 font-medium">✓ Use in real props</span>
                        ) : parseFloat(prop.accuracy) >= 50 ? (
                          <span className="text-yellow-600">⚠️ Marginal edge</span>
                        ) : (
                          <span className="text-red-600">✗ Avoid</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow p-8 mb-8 text-center">
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Generate Training Data
          </h3>
          <p className="text-gray-600 mb-4">
            Create mock props for today's games using free APIs
          </p>
          <form action="/api/training/generate" method="POST">
            <button
              type="submit"
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              🧪 Generate Mock Props for Today
            </button>
          </form>
          <p className="text-xs text-gray-500 mt-3">
            💡 Uses statistical models + free APIs. Zero cost!
          </p>
        </div>

        {/* Info Box */}
        <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-3">🧠 How Training Mode Works</h4>
          <div className="text-sm text-blue-800 space-y-2">
            <p><strong>1. Free Data:</strong> Uses ESPN/MLB Stats API (no cost) instead of paid odds</p>
            <p><strong>2. Statistical Models:</strong> Calculates probabilities using Poisson distribution</p>
            <p><strong>3. Synthetic Odds:</strong> Converts probabilities to odds for comparison</p>
            <p><strong>4. Validation:</strong> Checks predictions against actual game results</p>
            <p><strong>5. Learning:</strong> Identifies which prop types you're most accurate at</p>
            <p><strong>6. Improvement:</strong> Use insights to filter real props and improve picks</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## 🚀 Testing

### **1. Start the dev server:**
```bash
npm run dev
```

### **2. Generate mock props:**
```bash
curl -X POST http://localhost:3000/api/training/generate
```

### **3. View training stats:**
- Visit: `http://localhost:3000/validation/training`
- Or: `http://localhost:3000/api/training/stats`

### **4. Validate completed props:**
```bash
curl -X POST http://localhost:3000/api/training/validate
```

---

## 🎯 For Your Portfolio

**Talking Points:**
> "Built an ML training pipeline that generates and validates props using free APIs, enabling continuous model improvement without API costs. The system uses Poisson distribution for probability calculations and validates predictions against actual game results, providing data-driven insights to improve prop selection."

**Features to Highlight:**
- ✅ Zero-cost training data generation
- ✅ Statistical modeling (Poisson distribution)
- ✅ Automated validation pipeline
- ✅ Accuracy tracking by prop type
- ✅ Cost optimization ($0 vs paid API)

---

## 📊 Next Enhancements

1. **Auto-generate daily** (add to cron job)
2. **Use training data in real props** (filter by accuracy)
3. **Add charts/graphs** (accuracy trends over time)
4. **Player-specific accuracy** (which players you predict best)
5. **Confidence calibration** (adjust confidence based on training results)

---

**Status:** ✅ Backend complete, UI ready to add

