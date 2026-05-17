import React, { useState, useRef, useEffect } from "react";
import { DashboardFilters, DateRangeFilter, TreasuryHealth } from "@/lib/hooks/useDashboardFilters";
import { Filter, Calendar, Store as StoreIcon, Activity, ChevronDown, Check, X } from "lucide-react";

interface StoreOption {
    id: string;
    name: string;
}

interface DashboardFilterBarProps {
    filters: DashboardFilters;
    setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
    stores: StoreOption[];
}

export function DashboardFilterBar({ filters, setFilter, stores }: DashboardFilterBarProps) {
    const [openDropdown, setOpenDropdown] = useState<"date" | "store" | "health" | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpenDropdown(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const dateOptions: { value: DateRangeFilter; label: string }[] = [
        { value: "this_month", label: "This Month" },
        { value: "last_month", label: "Last Month" },
        { value: "last_3_months", label: "Last 3 Months" },
        { value: "last_6_months", label: "Last 6 Months" },
        { value: "all", label: "All Time" },
    ];

    const healthOptions: { value: TreasuryHealth; label: string; color: string }[] = [
        { value: "healthy", label: "Healthy", color: "bg-emerald-500" },
        { value: "low", label: "Low", color: "bg-amber-500" },
        { value: "negative", label: "Negative", color: "bg-red-500" },
    ];

    const handleStoreToggle = (storeId: string) => {
        const current = filters.selectedStores;
        if (current.includes(storeId)) {
            setFilter("selectedStores", current.filter((id) => id !== storeId));
        } else {
            setFilter("selectedStores", [...current, storeId]);
        }
    };

    const handleHealthToggle = (health: TreasuryHealth) => {
        const current = filters.treasuryHealth;
        if (current.includes(health)) {
            setFilter("treasuryHealth", current.filter((h) => h !== health));
        } else {
            setFilter("treasuryHealth", [...current, health]);
        }
    };

    const activeFilterCount =
        (filters.dateRange !== "this_month" ? 1 : 0) +
        (filters.selectedStores.length > 0 ? 1 : 0) +
        (filters.treasuryHealth.length > 0 ? 1 : 0);

    const clearFilters = () => {
        setFilter("dateRange", "this_month");
        setFilter("selectedStores", []);
        setFilter("treasuryHealth", []);
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm mb-8 flex items-center p-2 gap-2 relative z-10" ref={containerRef}>
            <div className="flex items-center gap-2 pl-2 pr-4 border-r border-slate-100">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">Filters</span>
                {activeFilterCount > 0 && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold ml-1">
                        {activeFilterCount}
                    </span>
                )}
            </div>

            {/* Date Range Filter */}
            <div className="relative">
                <button
                    onClick={() => setOpenDropdown(openDropdown === "date" ? null : "date")}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        openDropdown === "date" || filters.dateRange !== "this_month"
                            ? "bg-indigo-50 text-indigo-700 font-medium"
                            : "hover:bg-slate-50 text-slate-600"
                    }`}
                >
                    <Calendar className="w-4 h-4" />
                    {dateOptions.find((o) => o.value === filters.dateRange)?.label}
                    <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
                {openDropdown === "date" && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden z-20">
                        {dateOptions.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => {
                                    setFilter("dateRange", opt.value);
                                    setOpenDropdown(null);
                                }}
                                className="w-full flex items-center px-4 py-2 text-sm text-left hover:bg-slate-50 text-slate-700"
                            >
                                <span className="flex-1">{opt.label}</span>
                                {filters.dateRange === opt.value && <Check className="w-4 h-4 text-indigo-600" />}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Store Filter */}
            <div className="relative">
                <button
                    onClick={() => setOpenDropdown(openDropdown === "store" ? null : "store")}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        openDropdown === "store" || filters.selectedStores.length > 0
                            ? "bg-indigo-50 text-indigo-700 font-medium"
                            : "hover:bg-slate-50 text-slate-600"
                    }`}
                >
                    <StoreIcon className="w-4 h-4" />
                    {filters.selectedStores.length === 0
                        ? "All Stores"
                        : `${filters.selectedStores.length} Store${filters.selectedStores.length > 1 ? "s" : ""}`}
                    <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
                {openDropdown === "store" && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden z-20 max-h-64 overflow-y-auto">
                        <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <span className="text-xs font-medium text-slate-500">Select Stores</span>
                            {filters.selectedStores.length > 0 && (
                                <button
                                    onClick={() => setFilter("selectedStores", [])}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        {stores.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-500 text-center">No stores available</div>
                        ) : (
                            stores.map((store) => {
                                const isSelected = filters.selectedStores.includes(store.id);
                                return (
                                    <button
                                        key={store.id}
                                        onClick={() => handleStoreToggle(store.id)}
                                        className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-slate-50 text-slate-700"
                                    >
                                        <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <span className="flex-1 truncate">{store.name}</span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            {/* Treasury Health Filter */}
            <div className="relative">
                <button
                    onClick={() => setOpenDropdown(openDropdown === "health" ? null : "health")}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        openDropdown === "health" || filters.treasuryHealth.length > 0
                            ? "bg-indigo-50 text-indigo-700 font-medium"
                            : "hover:bg-slate-50 text-slate-600"
                    }`}
                >
                    <Activity className="w-4 h-4" />
                    {filters.treasuryHealth.length === 0
                        ? "Any Health"
                        : `${filters.treasuryHealth.length} State${filters.treasuryHealth.length > 1 ? "s" : ""}`}
                    <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
                {openDropdown === "health" && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden z-20">
                        <div className="px-3 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <span className="text-xs font-medium text-slate-500">Select Health</span>
                            {filters.treasuryHealth.length > 0 && (
                                <button
                                    onClick={() => setFilter("treasuryHealth", [])}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        {healthOptions.map((opt) => {
                            const isSelected = filters.treasuryHealth.includes(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => handleHealthToggle(opt.value)}
                                    className="w-full flex items-center px-3 py-2 text-sm text-left hover:bg-slate-50 text-slate-700"
                                >
                                    <div className={`w-4 h-4 rounded border mr-3 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                    </div>
                                    <span className={`w-2 h-2 rounded-full mr-2 ${opt.color}`} />
                                    <span className="flex-1">{opt.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Clear All */}
            {activeFilterCount > 0 && (
                <button
                    onClick={clearFilters}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                    Reset
                </button>
            )}
        </div>
    );
}
