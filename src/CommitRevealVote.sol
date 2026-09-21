// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Votes {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Token-weighted binary voting with hidden commitments and refundable stake.
contract CommitRevealVote {
    struct Proposal {
        bytes32 titleHash;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint256 againstVotes;
        uint256 forVotes;
    }

    struct Ballot {
        bytes32 commitment;
        uint256 amount;
        bool revealed;
        bool reclaimed;
    }

    IERC20Votes public immutable token;
    uint256 public proposalCount;
    mapping(uint256 proposalId => Proposal) public proposals;
    mapping(uint256 proposalId => mapping(address voter => Ballot)) public ballots;

    uint256 private locked = 1;

    event ProposalOpened(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 indexed titleHash,
        uint64 commitDeadline,
        uint64 revealDeadline
    );
    event VoteCommitted(uint256 indexed proposalId, address indexed voter, bytes32 commitment, uint256 amount);
    event VoteRevealed(uint256 indexed proposalId, address indexed voter, bool choice, uint256 amount);
    event TokensReclaimed(uint256 indexed proposalId, address indexed voter, uint256 amount);

    error InvalidToken();
    error InvalidDeadlines();
    error UnknownProposal();
    error CommitPhaseClosed();
    error RevealPhaseClosed();
    error AlreadyCommitted();
    error InvalidCommitment();
    error ZeroAmount();
    error NoCommitment();
    error AlreadyRevealed();
    error InvalidReveal();
    error TooEarlyToReclaim();
    error AlreadyReclaimed();
    error TokenTransferFailed();
    error Reentrancy();

    constructor(address token_) {
        if (token_ == address(0)) revert InvalidToken();
        token = IERC20Votes(token_);
    }

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    function openProposal(bytes32 titleHash, uint64 commitDeadline, uint64 revealDeadline)
        external
        returns (uint256 proposalId)
    {
        if (commitDeadline <= block.timestamp || revealDeadline <= commitDeadline) revert InvalidDeadlines();
        proposalId = ++proposalCount;
        proposals[proposalId] = Proposal(titleHash, commitDeadline, revealDeadline, 0, 0);
        emit ProposalOpened(proposalId, msg.sender, titleHash, commitDeadline, revealDeadline);
    }

    function commitVote(uint256 proposalId, bytes32 commitment, uint256 amount) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.commitDeadline == 0) revert UnknownProposal();
        if (block.timestamp >= proposal.commitDeadline) revert CommitPhaseClosed();
        if (amount == 0) revert ZeroAmount();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        Ballot storage ballot = ballots[proposalId][msg.sender];
        if (ballot.commitment != bytes32(0)) revert AlreadyCommitted();

        ballot.commitment = commitment;
        ballot.amount = amount;
        emit VoteCommitted(proposalId, msg.sender, commitment, amount);
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();
    }

    function revealVote(uint256 proposalId, bool choice, bytes32 salt) external {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.commitDeadline == 0) revert UnknownProposal();
        if (block.timestamp < proposal.commitDeadline || block.timestamp >= proposal.revealDeadline) {
            revert RevealPhaseClosed();
        }
        Ballot storage ballot = ballots[proposalId][msg.sender];
        if (ballot.commitment == bytes32(0)) revert NoCommitment();
        if (ballot.revealed) revert AlreadyRevealed();
        if (ballot.commitment != keccak256(abi.encode(choice, salt))) revert InvalidReveal();

        ballot.revealed = true;
        if (choice) proposal.forVotes += ballot.amount;
        else proposal.againstVotes += ballot.amount;
        emit VoteRevealed(proposalId, msg.sender, choice, ballot.amount);
    }

    function reclaim(uint256 proposalId) external nonReentrant {
        Proposal storage proposal = proposals[proposalId];
        if (proposal.commitDeadline == 0) revert UnknownProposal();
        if (block.timestamp < proposal.revealDeadline) revert TooEarlyToReclaim();
        Ballot storage ballot = ballots[proposalId][msg.sender];
        if (ballot.commitment == bytes32(0)) revert NoCommitment();
        if (ballot.reclaimed) revert AlreadyReclaimed();

        ballot.reclaimed = true;
        uint256 amount = ballot.amount;
        emit TokensReclaimed(proposalId, msg.sender, amount);
        if (!token.transfer(msg.sender, amount)) revert TokenTransferFailed();
    }
}
