'use client'

import { useState } from 'react'
import { format } from 'date-fns'

export default function CompletedPropsTable({ records }) {
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50
  
  // Calculate pagination
  const totalPages = Math.ceil(records.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentRecords = records.slice(startIndex, endIndex)
  
  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages = []
    const maxPagesToShow = 5 // Reduced for mobile
    
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      if (currentPage <= 2) {
        for (let i = 1; i <= 3; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 1) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 2; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        pages.push(currentPage)
        pages.push('...')
        pages.push(totalPages)
      }
    }
    
    return pages
  }
  
  return (
    <div className="card p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h3 className="text-lg font-semibold text-white">📜 Completed Props</h3>
        <span className="text-sm text-gray-400">
          {records.length} total
        </span>
      </div>
      
      {/* Mobile Card View */}
      <div className="block lg:hidden space-y-3">
        {currentRecords.map((record) => (
          <div key={record.id} className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            {/* Header Row */}
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                record.sport === 'nfl' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                record.sport === 'nhl' ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/50' :
                record.sport === 'mlb' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                'bg-slate-700 text-gray-400 border border-slate-600'
              }`}>
                {record.sport === 'nfl' ? '🏈 NFL' : 
                 record.sport === 'nhl' ? '🏒 NHL' :
                 record.sport === 'mlb' ? '⚾ MLB' :
                 record.sport?.toUpperCase() || 'N/A'}
              </span>
              
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                record.result === 'correct' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                record.result === 'push' ? 'bg-slate-700 text-gray-400 border border-slate-600' :
                'bg-red-900/30 text-red-400 border border-red-500/50'
              }`}>
                {record.result === 'correct' ? '✓ WIN' : 
                 record.result === 'push' ? '− PUSH' : 
                 '✗ LOSS'}
              </span>
            </div>
            
            {/* Player & Prop */}
            <div className="mb-3">
              <div className="text-base font-semibold text-white">{record.playerName}</div>
              <div className="text-sm text-gray-400">{record.propType.replace(/_/g, ' ')}</div>
            </div>
            
            {/* Prediction vs Actual */}
            <div className="grid grid-cols-2 gap-3 mb-3 p-3 bg-slate-900/50 rounded">
              <div>
                <div className="text-xs text-gray-400 mb-1">Prediction</div>
                <div className="text-sm font-bold text-white">
                  {record.prediction.toUpperCase()} {record.threshold}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Actual</div>
                <div className={`text-sm font-bold ${
                  record.result === 'correct' ? 'text-green-400' :
                  record.result === 'push' ? 'text-gray-400' :
                  'text-red-400'
                }`}>
                  {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                </div>
              </div>
            </div>
            
            {/* Metrics & Source */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-gray-400">
                  Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                </span>
                <span className="text-blue-400">
                  Edge: +{(record.edge * 100).toFixed(1)}%
                </span>
              </div>
              <span className="text-gray-500">
                {format(new Date(record.timestamp), 'MMM d')}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-700">
          <thead className="bg-slate-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Sport
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Result
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                Player & Prop
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Prediction
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Actual
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Metrics
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                Source
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                Date
              </th>
            </tr>
          </thead>
          <tbody className="bg-slate-800 divide-y divide-slate-700">
            {currentRecords.map((record) => (
              <tr key={record.id} className="hover:bg-slate-700/50">
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    record.sport === 'nfl' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                    record.sport === 'nhl' ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-500/50' :
                    record.sport === 'mlb' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                    'bg-slate-700 text-gray-400 border border-slate-600'
                  }`}>
                    {record.sport === 'nfl' ? '🏈 NFL' : 
                     record.sport === 'nhl' ? '🏒 NHL' :
                     record.sport === 'mlb' ? '⚾ MLB' :
                     record.sport?.toUpperCase() || 'N/A'}
                  </span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-1.5 rounded-full text-xs font-medium ${
                    record.result === 'correct' ? 'bg-green-900/30 text-green-400 border border-green-500/50' :
                    record.result === 'push' ? 'bg-slate-700 text-gray-400 border border-slate-600' :
                    'bg-red-900/30 text-red-400 border border-red-500/50'
                  }`}>
                    {record.result === 'correct' ? '✓ WIN' : 
                     record.result === 'push' ? '− PUSH' : 
                     '✗ LOSS'}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <div className="text-sm font-medium text-white">{record.playerName}</div>
                  <div className="text-xs text-gray-400">{record.propType.replace(/_/g, ' ')}</div>
                </td>
                <td className="px-4 py-4 text-center">
                  <div className="text-sm font-semibold text-white">
                    {record.prediction.toUpperCase()} {record.threshold}
                  </div>
                  {record.projectedValue && (
                    <div className="text-xs text-gray-400">
                      Proj: {record.projectedValue.toFixed(1)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-4 text-center">
                  <div className={`text-sm font-bold ${
                    record.result === 'correct' ? 'text-green-400' :
                    record.result === 'push' ? 'text-gray-400' :
                    'text-red-400'
                  }`}>
                    {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                  </div>
                </td>
                <td className="px-4 py-4 text-center">
                  <div className="text-xs space-y-1">
                    <div className="text-gray-400">
                      Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                    </div>
                    <div className="text-blue-400">
                      Edge: +{(record.edge * 100).toFixed(1)}%
                    </div>
                    {record.qualityScore && (
                      <div className="text-purple-400">
                        Q: {record.qualityScore.toFixed(0)}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 text-center">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    record.source === 'user_saved' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/50' :
                    record.source === 'parlay_leg' ? 'bg-purple-900/30 text-purple-400 border border-purple-500/50' :
                    'bg-slate-700 text-gray-400 border border-slate-600'
                  }`}>
                    {record.source === 'user_saved' ? '👤 Saved' :
                     record.source === 'parlay_leg' ? '🎯 Parlay' :
                     '🤖 Auto'}
                  </span>
                </td>
                <td className="px-4 py-4 text-right text-xs text-gray-400 whitespace-nowrap">
                  {format(new Date(record.timestamp), 'MMM d')}
                  <br />
                  {format(new Date(record.timestamp), 'h:mm a')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs sm:text-sm text-gray-400 text-center sm:text-left">
            Showing {startIndex + 1}-{Math.min(endIndex, records.length)} of {records.length}
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Previous Button */}
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                currentPage === 1
                  ? 'bg-slate-800 text-gray-600 cursor-not-allowed'
                  : 'bg-slate-800 text-white hover:bg-slate-700'
              }`}
            >
              <span className="hidden sm:inline">← Previous</span>
              <span className="sm:hidden">←</span>
            </button>
            
            {/* Page Numbers */}
            <div className="flex items-center gap-1">
              {getPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-1 sm:px-2 text-gray-400 text-xs sm:text-sm">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-gray-400 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {page}
                  </button>
                )
              ))}
            </div>
            
            {/* Next Button */}
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={`px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                currentPage === totalPages
                  ? 'bg-slate-800 text-gray-600 cursor-not-allowed'
                  : 'bg-slate-800 text-white hover:bg-slate-700'
              }`}
            >
              <span className="hidden sm:inline">Next →</span>
              <span className="sm:hidden">→</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

