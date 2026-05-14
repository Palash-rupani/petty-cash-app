export default function Loading() {
    return (
        <div className="p-6 space-y-6 animate-pulse">
            <div className="h-10 w-72 bg-slate-200 rounded-xl" />

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
                {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-24 bg-slate-200 rounded-2xl" />
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-72 bg-slate-200 rounded-2xl" />
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="h-80 bg-slate-200 rounded-2xl" />
                ))}
            </div>
        </div>
    )
}