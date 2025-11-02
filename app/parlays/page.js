// Parlay Generator Page - TEMPORARILY DISABLED DURING MIGRATION

'use client'

export default function ParlaysPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="container mx-auto px-4 py-16">
        {/* Maintenance Notice */}
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-8 mb-8">
            <h1 className="text-4xl font-bold text-yellow-400 mb-4">
              🔧 Parlay Generator Temporarily Unavailable
            </h1>
            <p className="text-xl text-yellow-200 mb-6">
              We're migrating to a new database system (Supabase) to improve performance and reliability.
            </p>
            <div className="bg-slate-800 rounded-lg p-6 text-left">
              <h2 className="text-lg font-semibold text-white mb-3">What's happening:</h2>
              <ul className="space-y-2 text-slate-300">
                <li>✅ Homepage with games - <span className="text-green-400">Working</span></li>
                <li>✅ Today's slate - <span className="text-green-400">Working</span></li>
                <li>✅ Game scores - <span className="text-green-400">Working</span></li>
                <li>⏸️ Parlay generator - <span className="text-yellow-400">Migrating</span></li>
                <li>⏸️ Player props - <span className="text-yellow-400">Migrating</span></li>
                <li>⏸️ Validation system - <span className="text-yellow-400">Migrating</span></li>
              </ul>
            </div>
            <div className="mt-6">
              <p className="text-slate-400">
                Expected completion: <span className="text-white font-semibold">Within 24 hours</span>
              </p>
              <p className="text-sm text-slate-500 mt-2">
                This feature will be back online once the migration is complete.
              </p>
            </div>
          </div>
          
          {/* Navigation Back */}
          <a 
            href="/" 
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition"
          >
            ← Back to Homepage
          </a>
        </div>
      </div>
    </div>
  )
}
