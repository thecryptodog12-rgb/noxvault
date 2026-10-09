/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/noxvault.json`.
 */
export type Noxvault = {
  "address": "8iDqwPFRxr2rHiuieVhGL4jdTT7XPE5qPAReS6VzTPw4",
  "metadata": {
    "name": "noxvault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelUnlock",
      "docs": [
        "Closes an unlock buffer and returns its rent. Only the payer who opened it."
      ],
      "discriminator": [
        116,
        58,
        36,
        132,
        24,
        104,
        170,
        228
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "finishUnlock",
      "docs": [
        "Pays out SOL once the signature rebuilds the vault. Permissionless."
      ],
      "discriminator": [
        46,
        111,
        83,
        152,
        117,
        133,
        10,
        247
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "spent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "dest",
          "writable": true
        },
        {
          "name": "nextVault",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finishUnlockToken",
      "docs": [
        "Pays out an SPL / Token-2022 token once the signature rebuilds the vault. Permissionless."
      ],
      "discriminator": [
        118,
        131,
        96,
        200,
        82,
        15,
        170,
        19
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "unlock",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "vault"
        },
        {
          "name": "spent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "dest"
        },
        {
          "name": "destAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "dest"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "nextVault",
          "writable": true
        },
        {
          "name": "nextAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "nextVault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openUnlock",
      "discriminator": [
        197,
        205,
        244,
        64,
        180,
        220,
        149,
        55
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault"
        },
        {
          "name": "unlock",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  108,
                  111,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "payer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "openArgs"
            }
          }
        }
      ]
    },
    {
      "name": "register",
      "docs": [
        "Lists a vault in the public explorer. Anyone can do it; it proves nothing but the address."
      ],
      "discriminator": [
        211,
        124,
        67,
        15,
        211,
        194,
        178,
        240
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault"
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sweep",
      "docs": [
        "Forwards all SOL in a spent vault to its successor. Permissionless."
      ],
      "discriminator": [
        40,
        23,
        234,
        175,
        14,
        61,
        154,
        177
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "spent"
          ]
        },
        {
          "name": "spent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "successor",
          "writable": true,
          "relations": [
            "spent"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "sweepToken",
      "docs": [
        "Forwards all of one token in a spent vault to its successor and closes the vault's ATA."
      ],
      "discriminator": [
        197,
        177,
        210,
        55,
        42,
        183,
        103,
        83
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
          "relations": [
            "spent"
          ]
        },
        {
          "name": "spent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "successor",
          "writable": true,
          "relations": [
            "spent"
          ]
        },
        {
          "name": "successorAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "successor"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "verify",
      "docs": [
        "Walks chains `from..to` to their ends. Freezes the buffer on first use. Permissionless."
      ],
      "discriminator": [
        133,
        161,
        141,
        48,
        120,
        198,
        88,
        150
      ],
      "accounts": [
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "from",
          "type": "u8"
        },
        {
          "name": "to",
          "type": "u8"
        }
      ]
    },
    {
      "name": "writeSigs",
      "discriminator": [
        216,
        242,
        142,
        114,
        134,
        77,
        2,
        154
      ],
      "accounts": [
        {
          "name": "payer",
          "signer": true,
          "relations": [
            "unlock"
          ]
        },
        {
          "name": "unlock",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "start",
          "type": "u8"
        },
        {
          "name": "sigs",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "record",
      "discriminator": [
        254,
        233,
        117,
        252,
        76,
        166,
        146,
        139
      ]
    },
    {
      "name": "spent",
      "discriminator": [
        54,
        176,
        134,
        161,
        102,
        243,
        161,
        234
      ]
    },
    {
      "name": "unlock",
      "discriminator": [
        187,
        122,
        21,
        254,
        7,
        157,
        241,
        10
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "wrongVault",
      "msg": "The vault address does not match"
    },
    {
      "code": 6001,
      "name": "nextIsSelf",
      "msg": "The next vault cannot be the vault itself"
    },
    {
      "code": 6002,
      "name": "destIsSelf",
      "msg": "The destination cannot be the vault itself"
    },
    {
      "code": 6003,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "frozen",
      "msg": "The signature can no longer change: verification has started"
    },
    {
      "code": 6005,
      "name": "chainOutOfRange",
      "msg": "Chain index out of range"
    },
    {
      "code": 6006,
      "name": "signatureIncomplete",
      "msg": "Not every chain of the signature has been written"
    },
    {
      "code": 6007,
      "name": "notVerified",
      "msg": "Not every chain has been verified"
    },
    {
      "code": 6008,
      "name": "badSignature",
      "msg": "The signature does not rebuild this vault"
    },
    {
      "code": 6009,
      "name": "wrongPayer",
      "msg": "Rent receiver must be the account that opened the unlock"
    },
    {
      "code": 6010,
      "name": "wrongDest",
      "msg": "Destination does not match the signed message"
    },
    {
      "code": 6011,
      "name": "wrongNext",
      "msg": "Next vault does not match the signed message"
    },
    {
      "code": 6012,
      "name": "wrongMint",
      "msg": "Asset does not match the signed message"
    },
    {
      "code": 6013,
      "name": "insufficientFunds",
      "msg": "The vault holds less than the signed amount"
    },
    {
      "code": 6014,
      "name": "dustTooSmall",
      "msg": "Too little SOL to open the successor vault"
    }
  ],
  "types": [
    {
      "name": "openArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pkSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "nextVault",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "record",
      "docs": [
        "Optional public listing of a vault, for the explorer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "spent",
      "docs": [
        "Marks a vault key as used. Its existence is what stops a key from ever signing twice."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "successor",
            "docs": [
              "Where everything left in (or later sent to) this vault is forwarded."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unlock",
      "docs": [
        "A signed withdrawal being assembled and verified over several transactions.",
        "Zero-copy: the signature and chain ends are too big for the BPF stack."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "written",
            "docs": [
              "Bit j set once chain j's signature value is written."
            ],
            "type": "u64"
          },
          {
            "name": "verified",
            "docs": [
              "Bit j set once chain j has been walked to its end."
            ],
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "pkSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "dest",
            "type": "pubkey"
          },
          {
            "name": "nextVault",
            "type": "pubkey"
          },
          {
            "name": "digits",
            "docs": [
              "Digits of the message digest, fixed when the buffer freezes."
            ],
            "type": {
              "array": [
                "u8",
                34
              ]
            }
          },
          {
            "name": "frozen",
            "docs": [
              "1 once verification started: the message and signature can no longer change."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "sigs",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          },
          {
            "name": "ends",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                34
              ]
            }
          }
        ]
      }
    }
  ]
};
