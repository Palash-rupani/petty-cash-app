import { getStoreBalance } from "@/lib/utils/getStoreBalance";
import { getStoreReservations } from "@/lib/finance/getStoreReservations";

export interface AvailableBalanceData {
    actualBalance: number;
    reservedAmount: number;
    availableBalance: number;
    activeReservations: number;
}

export async function getAvailableBalance(
    storeId: string
): Promise<AvailableBalanceData | null> {
    const actualBalance = await getStoreBalance(storeId);

    if (actualBalance === null) {
        return null;
    }

    const reservationData = await getStoreReservations(storeId);

    const availableBalance =
        actualBalance - reservationData.reservedAmount;

    return {
        actualBalance,
        reservedAmount: reservationData.reservedAmount,
        availableBalance,
        activeReservations: reservationData.activeReservations,
    };
}