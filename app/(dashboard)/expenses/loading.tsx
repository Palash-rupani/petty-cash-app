export default function Loading() {
    return (
        <div className="p-6">
            <div className="animate-pulse space-y-4">
                <div className="h-8 w-40 bg-slate-200 rounded" />
                <div className="h-20 bg-slate-200 rounded-xl" />
                <div className="h-20 bg-slate-200 rounded-xl" />
                <div className="h-20 bg-slate-200 rounded-xl" />
            </div>
        </div>
    )
}