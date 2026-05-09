import { contractAbis, localDeployment } from "../../shared/contracts";
import { isAddress } from "viem";

export const dashboardContracts = {
  abis: contractAbis,
  deployment: localDeployment,
  hasLocalDeployment: Boolean(
    localDeployment?.intentBatcher &&
      localDeployment?.mockUSDC &&
      isAddress(localDeployment.intentBatcher) &&
      isAddress(localDeployment.mockUSDC)
  )
};
