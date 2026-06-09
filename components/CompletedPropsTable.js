'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { cn } from '../lib/utils'
import { SportBadge } from './ui'

const RESULT_LABEL = {
  correct: 'WIN',
  push: 'PUSH',
  incorrect: 'LOSS',
}

function resultClasses(result) {
  if (result === 'correct') return 'bg-green-500/10 text-green-400 border-green-500/20'
  if (result === 'push') return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
  return 'bg-red-500/10 text-red-400 border-red-500/20'
}

function resultText(result) {
  if (result === 'correct') return 'text-green-400'
  if (result === 'push') return 'text-slate-400'
  return 'text-red-400'
}

const SOURCE_LABEL = {
  user_saved: 'Saved',
  parlay_leg: 'Parlay',
}

function sourceClasses(source) {
  if (source === 'user_saved') return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  if (source === 'parlay_leg') return 'bg-white/[0.05] text-slate-300 border-white/[0.06]'
  return 'bg-white/[0.05] text-slate-400 border-white/[0.06]'
}

const TH_CLASS = 'px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wider'

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
    <div className="rounded-[4px] border border-white/[0.06] bg-surface p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Completed Props</h3>
        <span className="text-[11px] text-slate-500 tabular-nums font-mono">
          {records.length} total
        </span>
      </div>
      
      {/* Mobile Card View */}
      <div className="block lg:hidden space-y-3">
        {currentRecords.map((record) => (
          <div key={record.id} className="bg-bg rounded-[4px] p-4 border border-white/[0.06]">
            {/* Header Row */}
            <div className="flex items-center justify-between mb-3">
              {record.sport ? <SportBadge sport={record.sport} /> : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 border border-white/[0.06]">N/A</span>
              )}
              <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border', resultClasses(record.result))}>
                {RESULT_LABEL[record.result] || 'LOSS'}
              </span>
            </div>
            
            {/* Player & Prop */}
            <div className="mb-3">
              <div className="text-sm font-semibold text-slate-100">{record.playerName}</div>
              <div className="text-xs text-slate-400 capitalize">{record.propType.replace(/_/g, ' ')}</div>
            </div>
            
            {/* Prediction vs Actual */}
            <div className="grid grid-cols-2 gap-3 mb-3 p-3 bg-surface border border-white/[0.06] rounded-[4px]">
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">Prediction</div>
                <div className="text-sm font-semibold text-slate-100 tabular-nums font-mono">
                  {record.prediction.toUpperCase()} {record.threshold}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">Actual</div>
                <div className={cn('text-sm font-semibold tabular-nums font-mono', resultText(record.result))}>
                  {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                </div>
              </div>
            </div>
            
            {/* Metrics & Source */}
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-3 tabular-nums font-mono">
                <span className="text-slate-400">
                  Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                </span>
                <span className="text-blue-400">
                  Edge: +{(record.edge * 100).toFixed(1)}%
                </span>
              </div>
              <span className="text-slate-500 tabular-nums font-mono">
                {format(new Date(record.timestamp), 'MMM d')}
              </span>
            </div>
          </div>
        ))}
      </div>
      
      {/* Desktop Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-bg border-y border-white/[0.06]">
            <tr>
              <th className={`${TH_CLASS} text-left`}>Sport</th>
              <th className={`${TH_CLASS} text-left`}>Result</th>
              <th className={`${TH_CLASS} text-left`}>Player &amp; Prop</th>
              <th className={`${TH_CLASS} text-center`}>Prediction</th>
              <th className={`${TH_CLASS} text-center`}>Actual</th>
              <th className={`${TH_CLASS} text-center`}>Metrics</th>
              <th className={`${TH_CLASS} text-center`}>Source</th>
              <th className={`${TH_CLASS} text-right`}>Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {currentRecords.map((record) => (
              <tr key={record.id} className="hover:bg-elevated transition-colors duration-100">
                <td className="px-4 py-3 whitespace-nowrap">
                  {record.sport ? <SportBadge sport={record.sport} /> : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide bg-white/[0.05] text-slate-400 border border-white/[0.06]">N/A</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold uppercase tracking-wide border', resultClasses(record.result))}>
                    {RESULT_LABEL[record.result] || 'LOSS'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-slate-100">{record.playerName}</div>
                  <div className="text-xs text-slate-400 capitalize">{record.propType.replace(/_/g, ' ')}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-sm font-semibold text-slate-100 tabular-nums font-mono">
                    {record.prediction.toUpperCase()} {record.threshold}
                  </div>
                  {record.projectedValue && (
                    <div className="text-xs text-slate-500 tabular-nums font-mono">
                      Proj: {record.projectedValue.toFixed(1)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className={cn('text-sm font-semibold tabular-nums font-mono', resultText(record.result))}>
                    {record.actualValue !== null ? record.actualValue.toFixed(1) : 'N/A'}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-[11px] space-y-0.5 tabular-nums font-mono">
                    <div className="text-slate-400">
                      Win: {((record.probability || 0.5) * 100).toFixed(0)}%
                    </div>
                    <div className="text-blue-400">
                      Edge: +{(record.edge * 100).toFixed(1)}%
                    </div>
                    {record.qualityScore && (
                      <div className="text-slate-400">
                        Q: {record.qualityScore.toFixed(0)}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium uppercase tracking-wide border', sourceClasses(record.source))}>
                    {SOURCE_LABEL[record.source] || 'Auto'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-[11px] text-slate-500 whitespace-nowrap tabular-nums font-mono">
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
          <div className="text-[11px] text-slate-500 text-center sm:text-left tabular-nums font-mono">
            Showing {startIndex + 1}-{Math.min(endIndex, records.length)} of {records.length}
          </div>
          
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Previous Button */}
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={cn(
                'px-2 sm:px-3 py-1.5 rounded-[4px] text-xs font-medium border transition-colors duration-100',
                currentPage === 1
                  ? 'bg-surface text-slate-600 border-white/[0.06] cursor-not-allowed'
                  : 'bg-surface text-slate-200 border-white/[0.06] hover:bg-elevated',
              )}
            >
              <span className="hidden sm:inline">← Previous</span>
              <span className="sm:hidden">←</span>
            </button>
            
            {/* Page Numbers */}
            <div className="flex items-center gap-1">
              {getPageNumbers().map((page, index) => (
                page === '...' ? (
                  <span key={`ellipsis-${index}`} className="px-1 sm:px-2 text-slate-500 text-xs">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      'px-2 sm:px-3 py-1.5 rounded-[4px] text-xs font-medium border transition-colors duration-100 tabular-nums font-mono',
                      currentPage === page
                        ? 'bg-elevated text-slate-100 border-white/[0.12]'
                        : 'bg-surface text-slate-400 border-white/[0.06] hover:bg-elevated hover:text-slate-200',
                    )}
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
              className={cn(
                'px-2 sm:px-3 py-1.5 rounded-[4px] text-xs font-medium border transition-colors duration-100',
                currentPage === totalPages
                  ? 'bg-surface text-slate-600 border-white/[0.06] cursor-not-allowed'
                  : 'bg-surface text-slate-200 border-white/[0.06] hover:bg-elevated',
              )}
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
