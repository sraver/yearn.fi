import React, {createContext, useCallback, useContext, useState} from 'react';
import {useDebouncedEffect, useDeepCompareMemo} from '@react-hookz/web';
import {useActionFlow} from '@vaults/contexts/useActionFlow';
import {useSolverChainCoin} from '@vaults/hooks/useSolverChainCoin';
import {useSolverCowswap} from '@vaults/hooks/useSolverCowswap';
import {useSolverInternalMigration} from '@vaults/hooks/useSolverInternalMigration';
import {useSolverPartnerContract} from '@vaults/hooks/useSolverPartnerContract';
import {useSolverPortals} from '@vaults/hooks/useSolverPortals';
import {useSolverVanilla} from '@vaults/hooks/useSolverVanilla';
import {useSolverWido} from '@vaults/hooks/useSolverWido';
import {useWeb3} from '@yearn-finance/web-lib/contexts/useWeb3';
import {toAddress} from '@yearn-finance/web-lib/utils/address';
import {toNormalizedBN} from '@yearn-finance/web-lib/utils/format.bigNumber';
import performBatchedUpdates from '@yearn-finance/web-lib/utils/performBatchedUpdates';

import type {TNormalizedBN} from '@common/types/types';
import type {TInitSolverArgs, TWithSolver} from '@vaults/types/solvers';

export enum	Solver {
	VANILLA = 'Vanilla',
	PARTNER_CONTRACT = 'PartnerContract',
	CHAIN_COIN = 'ChainCoin',
	INTERNAL_MIGRATION = 'InternalMigration',
	COWSWAP = 'Cowswap',
	WIDO = 'Wido',
	PORTALS = 'Portals'
}

export const isSolverDisabled = {
	[Solver.VANILLA]: false,
	[Solver.PARTNER_CONTRACT]: false,
	[Solver.CHAIN_COIN]: false,
	[Solver.INTERNAL_MIGRATION]: false,
	[Solver.COWSWAP]: false,
	[Solver.WIDO]: false,
	[Solver.PORTALS]: false
};

const	DefaultWithSolverContext: TWithSolver = {
	currentSolver: Solver.VANILLA,
	effectiveSolver: Solver.VANILLA,
	expectedOut: toNormalizedBN(0),
	isLoadingExpectedOut: false,
	onRetrieveExpectedOut: async (): Promise<TNormalizedBN> => toNormalizedBN(0),
	onRetrieveAllowance: async (): Promise<TNormalizedBN> => toNormalizedBN(0),
	onApprove: async (): Promise<void> => Promise.resolve(),
	onExecuteDeposit: async (): Promise<void> => Promise.resolve(),
	onExecuteWithdraw: async (): Promise<void> => Promise.resolve()
};

const		WithSolverContext = createContext<TWithSolver>(DefaultWithSolverContext);
function	WithSolverContextApp({children}: {children: React.ReactElement}): React.ReactElement {
	const {address} = useWeb3();
	const {currentVault, actionParams, currentSolver, isDepositing} = useActionFlow();
	const cowswap = useSolverCowswap();
	const wido = useSolverWido();
	const vanilla = useSolverVanilla();
	const portals = useSolverPortals();
	const chainCoin = useSolverChainCoin();
	const partnerContract = useSolverPartnerContract();
	const internalMigration = useSolverInternalMigration();
	const [currentSolverState, set_currentSolverState] = useState(vanilla);
	const [isLoading, set_isLoading] = useState(false);

	/* 🔵 - Yearn Finance **************************************************************************
	** Based on the currentSolver, we initialize the solver with the required parameters.
	**********************************************************************************************/
	const	onUpdateSolver = useCallback(async (): Promise<void> => {
		if (!actionParams?.selectedOptionFrom || !actionParams?.selectedOptionTo || !actionParams?.amount) {
			return;
		}
		set_isLoading(true);

		let quote: TNormalizedBN = toNormalizedBN(0);
		const request: TInitSolverArgs = {
			from: toAddress(address || ''),
			inputToken: actionParams?.selectedOptionFrom,
			outputToken: actionParams?.selectedOptionTo,
			inputAmount: actionParams?.amount.raw,
			isDepositing: isDepositing
		};

		switch (currentSolver) {
			case Solver.WIDO:
			case Solver.PORTALS:
			case Solver.COWSWAP: {
				const promises = [wido.init(request), cowswap.init(request), portals.init(request)];
				const [widoQuote, cowswapQuote, portalsQuote] = await Promise.allSettled(promises);

				/**************************************************************
				** Logic is to use the primary solver (Wido) and check if a
				** quote is available. If not, we fallback to the secondary
				** solver (Cowswap). If neither are available, we set the
				** quote to 0.
				**************************************************************/
				if (currentSolver === Solver.WIDO && !isSolverDisabled[Solver.WIDO]) {
					if (widoQuote.status === 'fulfilled' && widoQuote?.value.raw?.gt(0)) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...wido, quote: widoQuote.value});
							set_isLoading(false);
						});
					} else if (cowswapQuote.status === 'fulfilled' && cowswapQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.COWSWAP]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...cowswap, quote: cowswapQuote.value});
							set_isLoading(false);
						});
					} else if (portalsQuote.status === 'fulfilled' && portalsQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.PORTALS]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...portals, quote: portalsQuote.value});
							set_isLoading(false);
						});
					} else {
						performBatchedUpdates((): void => {
							set_currentSolverState({...cowswap, quote: toNormalizedBN(0)});
							set_isLoading(false);
						});
					}
					return;
				}

				/**************************************************************
				** Logic is to use the primary solver (Cowswap) and check if a
				** quote is available. If not, we fallback to the secondary
				** solver (Wido). If neither are available, we set the
				** quote to 0.
				**************************************************************/
				if (currentSolver === Solver.COWSWAP && !isSolverDisabled[Solver.COWSWAP]) {
					if (cowswapQuote.status === 'fulfilled' && cowswapQuote.value.raw?.gt(0)) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...cowswap, quote: cowswapQuote.value});
							set_isLoading(false);
						});
					} else if (widoQuote.status === 'fulfilled' && widoQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.WIDO]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...wido, quote: widoQuote.value});
							set_isLoading(false);
						});
					} else if (portalsQuote.status === 'fulfilled' && portalsQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.PORTALS]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...portals, quote: portalsQuote.value});
							set_isLoading(false);
						});
					} else {
						performBatchedUpdates((): void => {
							set_currentSolverState({...wido, quote: toNormalizedBN(0)});
							set_isLoading(false);
						});
					}
				}

				/**************************************************************
				** Logic is to use the primary solver (Portals) and check if a
				** quote is available. If not, we fallback to the secondary
				** solver (Wido). If neither are available, we set the
				** quote to 0.
				**************************************************************/
				if (currentSolver === Solver.PORTALS && !isSolverDisabled[Solver.PORTALS]) {
					if (portalsQuote.status === 'fulfilled' && portalsQuote.value.raw?.gt(0)) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...portals, quote: portalsQuote.value});
							set_isLoading(false);
						});
					} else if (widoQuote.status === 'fulfilled' && widoQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.WIDO]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...wido, quote: widoQuote.value});
							set_isLoading(false);
						});
					} else if (cowswapQuote.status === 'fulfilled' && cowswapQuote.value.raw?.gt(0) && !isSolverDisabled[Solver.COWSWAP]) {
						performBatchedUpdates((): void => {
							set_currentSolverState({...cowswap, quote: cowswapQuote.value});
							set_isLoading(false);
						});
					} else {
						performBatchedUpdates((): void => {
							set_currentSolverState({...wido, quote: toNormalizedBN(0)});
							set_isLoading(false);
						});
					}
				}

				set_isLoading(false);

				break;
			}
			case Solver.CHAIN_COIN:
				quote = await chainCoin.init(request);
				performBatchedUpdates((): void => {
					set_currentSolverState({...chainCoin, quote});
					set_isLoading(false);
				});
				break;
			case Solver.PARTNER_CONTRACT:
				quote = await partnerContract.init(request);
				performBatchedUpdates((): void => {
					set_currentSolverState({...partnerContract, quote});
					set_isLoading(false);
				});
				break;
			case Solver.INTERNAL_MIGRATION:
				request.migrator = currentVault.migration.contract;
				quote = await internalMigration.init(request);
				performBatchedUpdates((): void => {
					set_currentSolverState({...internalMigration, quote});
					set_isLoading(false);
				});
				break;
			default:
				quote = await vanilla.init(request);
				performBatchedUpdates((): void => {
					set_currentSolverState({...vanilla, quote});
					set_isLoading(false);
				});
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [address, actionParams, currentSolver, cowswap.init, vanilla.init, wido.init, internalMigration.init, isDepositing, currentVault.migration.contract]); //Ignore the warning, it's a false positive

	useDebouncedEffect((): void => {
		onUpdateSolver();
	}, [onUpdateSolver], 0);

	const	contextValue = useDeepCompareMemo((): TWithSolver => ({
		currentSolver: currentSolver,
		effectiveSolver: currentSolverState?.type,
		expectedOut: currentSolverState?.quote || toNormalizedBN(0),
		isLoadingExpectedOut: isLoading,
		onRetrieveExpectedOut: currentSolverState.onRetrieveExpectedOut,
		onRetrieveAllowance: currentSolverState.onRetrieveAllowance,
		onApprove: currentSolverState.onApprove,
		onExecuteDeposit: currentSolverState.onExecuteDeposit,
		onExecuteWithdraw: currentSolverState.onExecuteWithdraw
	}), [currentSolver, currentSolverState, isLoading]);

	return (
		<WithSolverContext.Provider value={contextValue}>
			{children}
		</WithSolverContext.Provider>
	);
}

export {WithSolverContextApp};
export const useSolver = (): TWithSolver => useContext(WithSolverContext);
