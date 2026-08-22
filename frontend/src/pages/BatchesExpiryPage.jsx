import React, { useState, useEffect } from 'react';
import { 
  Boxes, AlertTriangle, Clock, CheckCircle2, ShieldAlert, 
  Trash2, Tag, Percent, RefreshCw, Search, ArrowRight, ShieldCheck 
} from 'lucide-react';
import api from '../lib/api';
import { useFeedback } from '../components/FeedbackProvider';
import { useCapabilities } from '../context/CapabilityContext';
import PageContainer from '../components/layout/PageContainer';
import { PageHeader, Badge, Button } from '../components/UI';

export default function BatchesExpiryPage() {
  const { toast, confirm } = useFeedback();
  const { hasCapability } = useCapabilities();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all'); // all | expired | critical | expiring_soon
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventory/batches/summary');
      setData(res.data);
    } catch (e) {
      toast('Failed to load batch expiry data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const summary = data?.summary || {
    total_batch_items: 0,
    expired_count: 0,
    critical_7d_count: 0,
    expiring_30d_count: 0,
    healthy_count: 0,
  };

  const getFilteredItems = () => {
    if (!data) return [];
    let items = [];
    if (activeFilter === 'expired') items = data.expired || [];
    else if (activeFilter === 'critical') items = data.critical_7d || [];
    else if (activeFilter === 'expiring_soon') items = data.expiring_30d || [];
    else items = [...(data.expired || []), ...(data.critical_7d || []), ...(data.expiring_30d || []), ...(data.healthy || [])];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => 
        i.name.toLowerCase().includes(q) || 
        i.batch_number.toLowerCase().includes(q) ||
        (i.sku && i.sku.toLowerCase().includes(q))
      );
    }
    return items;
  };

  const filteredItems = getFilteredItems();

  return (
    <PageContainer className="pb-8">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Perishable & FEFO Management"
          title="Batch & Expiry Control Center"
          subtitle="Track expiration dates, monitor perishable stock risk zones, and manage inventory turnover."
          action={
            <Button size="sm" onClick={fetchBatches} className="flex items-center gap-2">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh Data
            </Button>
          }
        />

        {/* Risk Zone KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Expired / Critical Waste */}
          <div 
            onClick={() => setActiveFilter('expired')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              activeFilter === 'expired' 
                ? 'bg-rose-500/10 border-rose-500 ring-2 ring-rose-500/20' 
                : 'bg-slate-900/60 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-400">Past Expiry Date</span>
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <ShieldAlert size={16} />
              </div>
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-black text-white font-mono">{summary.expired_count}</h3>
              <p className="text-xs text-rose-300 mt-0.5">Action: Waste write-off or return</p>
            </div>
          </div>

          {/* Critical (Next 7 Days) */}
          <div 
            onClick={() => setActiveFilter('critical')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              activeFilter === 'critical' 
                ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/20' 
                : 'bg-slate-900/60 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">Critical (1–7 Days)</span>
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                <AlertTriangle size={16} />
              </div>
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-black text-white font-mono">{summary.critical_7d_count}</h3>
              <p className="text-xs text-amber-300 mt-0.5">Urgent clearance markdown</p>
            </div>
          </div>

          {/* Expiring Soon (8-30 Days) */}
          <div 
            onClick={() => setActiveFilter('expiring_soon')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              activeFilter === 'expiring_soon' 
                ? 'bg-sky-500/10 border-sky-500 ring-2 ring-sky-500/20' 
                : 'bg-slate-900/60 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-sky-400">Expiring Soon (8–30 Days)</span>
              <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400">
                <Clock size={16} />
              </div>
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-black text-white font-mono">{summary.expiring_30d_count}</h3>
              <p className="text-xs text-sky-300 mt-0.5">FEFO priority selling</p>
            </div>
          </div>

          {/* Healthy Stock */}
          <div 
            onClick={() => setActiveFilter('all')}
            className={`p-4 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
              activeFilter === 'all' 
                ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/20' 
                : 'bg-slate-900/60 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Total Tracked Batches</span>
              <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <div className="mt-3">
              <h3 className="text-2xl font-black text-white font-mono">{summary.total_batch_items}</h3>
              <p className="text-xs text-emerald-300 mt-0.5">{summary.healthy_count} Batches Healthy</p>
            </div>
          </div>

        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-white/10">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by product, batch # or SKU..."
              className="w-full pl-10 pr-4 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {['all', 'expired', 'critical', 'expiring_soon'].map(filterKey => (
              <button
                key={filterKey}
                onClick={() => setActiveFilter(filterKey)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer capitalize ${
                  activeFilter === filterKey
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                {filterKey.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Batches Table */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-black/30 border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">Batch Number</th>
                  <th className="px-4 py-3">Expiry Date</th>
                  <th className="px-4 py-3 text-center">Days Left</th>
                  <th className="px-4 py-3 text-right">Available Qty</th>
                  <th className="px-4 py-3 text-right">Stock Value</th>
                  <th className="px-4 py-3 text-center">Risk Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredItems.map(item => {
                  const isExpired = item.status === 'expired';
                  const isCritical = item.status === 'critical';
                  const isExpiring = item.status === 'expiring_soon';

                  return (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition">
                      <td className="px-4 py-3.5 font-bold text-white">
                        <div>{item.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{item.sku || 'No SKU'}</div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-300 font-bold">
                        {item.batch_number}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-300">
                        {item.expiry_date || 'N/A'}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-bold">
                        {item.days_to_expiry !== null ? (
                          <span className={isExpired ? 'text-rose-400' : isCritical ? 'text-amber-400' : isExpiring ? 'text-sky-400' : 'text-emerald-400'}>
                            {item.days_to_expiry < 0 ? `${Math.abs(item.days_to_expiry)}d Ago` : `${item.days_to_expiry}d`}
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-white">
                        {item.quantity} {item.unit_of_measure}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-300">
                        Rs. {item.stock_value.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                          isExpired 
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' 
                            : isCritical
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : isExpiring
                            ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}>
                          {item.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      No batch items match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </PageContainer>
  );
}
