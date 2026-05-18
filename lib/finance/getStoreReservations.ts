import { createClient } from "@/lib/supabase/client";

export interface StoreReservationData {
    reservedAmount: number;
    activeReservations: number;
}

export async function getStoreReservations(
    storeId: string
): Promise<StoreReservationData> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from("treasury_reservations")
        .select("amount")
        .eq("store_id", storeId)
        .eq("status", "active");

    if (error || !data) {
        console.error("Error fetching reservations:", error);

        return {
            reservedAmount: 0,
            activeReservations: 0,
        };
    }

    const reservedAmount = data.reduce(
        (sum, reservation) => sum + Number(reservation.amount || 0),
        0
    );

    return {
        reservedAmount,
        activeReservations: data.length,
    };
}