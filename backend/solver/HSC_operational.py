"""Hydrogen Hub operational optimization model.

Release v5 modifications remove only mathematically disconnected or unused
components: the maximum-demand billing subsystem, unused count/idle variables,
and an unused CPLEX import. Physical hydrogen, electricity, storage, transport,
solar, railway, unit-commitment, and emissions equations remain active.
"""
import pyomo.environ as pyo
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
# -------------------------------------#
johor = pd.read_csv('facilities_johor118.csv')
pp = pd.read_csv('plants_johor118.csv')
h2 = pd.read_csv('h2_johor118.csv')
power = pd.read_csv('power_johor118.csv')
storage = pd.read_csv('storage_johor118.csv')
sf = pd.read_csv('solar_johor118.csv')
tess = pd.read_csv('vehicles_johor118.csv')
train = pd.read_csv('rw_johor118.csv')
pipe = pd.read_csv('pipes_johor118.csv',index_col=0)
pathx = pd.read_csv('path_johor118.csv', index_col=0)
pathd = pd.read_csv('distances_johor118.csv', index_col=0)

# solar['time'] = pd.to_datetime(solar['time'], format="%d/%m/%Y %H:%M").tolist()
# -------------------------------------#
#           Mass Balance of Plant
def plantprocess_block(b):
    model = b.model()

    # process potential
    def process_pot_rule(b, p, m, t):
        consuming = [r for (pl,r) in model.PlantProcess if pl == p and model.material_in[r] == m]

        if len(consuming) == 0:
            return pyo.Constraint.Skip
    # amount of material consumed
        consumption = sum(model.process_res[p,r,t] for r in consuming)
        if t == model.T.first():
            available = (model.init_inven[p,m] 
                         + sum((model.v_locdischarge[v,p,t] for v in model.V if model.v_filter[v]==m))
                         + sum((model.rw_unload[r,t] for r in model.RW if model.rw_path[r,t]==p)))#+ model.vehicle_out[p,m,t])
        else:
            available = (model.plant_inven[p,m,t-1] 
                         + sum((model.v_locdischarge[v,p,t] for v in model.V if model.v_filter[v]==m))
                         + sum((model.rw_load[r,t] for r in model.RW if model.rw_path[r,t]==p)))#+ model.vehicle_out[p,m,t])
        return consumption <= available
    b.process_pot_cons = pyo.Constraint(model.P, model.Material, model.T, rule=process_pot_rule)

    # Inventory Track
    def plant_inv_rule(b, p, m, t):
        consumption = sum(model.process_res[p,r,t] for (pl,r) in model.PlantProcess if pl == p and model.material_in[r] == m)
        production = sum(model.stoich[r]*model.process_res[p,r,t] for (pl,r) in model.PlantProcess if pl == p and model.material_out[r] == m)

        if t == model.T.first():
            previous = model.init_inven[p,m]
        else:
            previous = model.plant_inven[p,m,t-1]
        return (model.plant_inven[p,m,t] == previous 
                + sum((model.v_locdischarge[v,p,t] for v in model.V if model.v_filter[v]==m))#model.vehicle_out[p,m,t] 
                + sum((model.rw_unload[r,t] for r in model.RW if model.rw_path[r,t]==p))
                - sum((model.v_loccharge[v,p,t] for v in model.V if model.v_filter[v]==m))#model.vehicle_in[p,m,t] 
                - sum((model.rw_load[r,t] for r in model.RW if model.rw_path[r,t]==p))
                - consumption + production)
    b.plant_inv_cons = pyo.Constraint(model.P, model.Material, model.T, rule=plant_inv_rule)

    # Capacity
    def plant_cap_rule(b, p, r, t):
        return pyo.inequality(model.plant_mincap[p,r], model.process_res[p,r,t], model.plant_maxcap[p,r])
    b.plant_cap_cons = pyo.Constraint(model.PlantProcess, model.T, rule=plant_cap_rule)

    # temp
    # def vehicle_in_rule(b, p, m):
    #     return sum(model.vehicle_in[p,m,t] for t in model.T) <= 20000
    # b.vehicle_in_cons = pyo.Constraint(model.P, model.Material, rule=vehicle_in_rule)

    # def vehicle_out_rule(b, p, m):
    #     return sum(model.vehicle_out[p,m,t] for t in model.T) <= 20000
    # b.vehicle_out_cons = pyo.Constraint(model.P, model.Material, rule=vehicle_out_rule)

    def inven_rule(b, p, m, t):
        return model.plant_inven[p,m,t] <= model.mat_cap[model.pfilter[p],m]
    b.inven_cons = pyo.Constraint(model.P, model.Material, model.T, rule=inven_rule)


# -------------------------------------#
#           H2 Balance in System
def h2balance_block(b):
    model = b.model()

    #   Plant Updates 
    def h2_balance_rule(b,h,t):
        inflow = (sum(model.pipe_out[i,h,t] for i in model.H)
                  + sum((model.v_locdischarge[v,h,t] for v in model.V if (model.v_filter[v]=='99H2' or model.v_filter[v]=='FCEV')))
                  + sum(model.discharge[s,t] for s in model.Stor if model.s_filter[s]=='H2' and model.stor_link[s]==h)) 
        outflow = (sum(model.pipe_in[h,j,t] for j in model.H)
                   + sum((model.v_loccharge[v,h,t] for v in model.V if (model.v_filter[v]=='99H2' or model.v_filter[v]=='FCEV')))
                   + sum(model.charge[s,t] for s in model.Stor if model.s_filter[s]=='H2' and model.stor_link[s]==h))
        if t == model.T.first():
            prev = 0
        else:
            prev = model.h2_inven[h,t-1]
        return (model.h2_inven[h,t] == prev + inflow - outflow)
    b.h2_balance_cons = pyo.Constraint(model.H, model.T, rule=h2_balance_rule)

    def h2_demand_rule(b,h):
        return model.h2_balance[h] == model.h2_demand[h] - sum(model.h2_inven[h,t] for t in model.T)
    b.h2_demand_cons = pyo.Constraint(model.H, rule=h2_demand_rule)

    def h2_cap_rule(b,h,t):
        return model.h2_inven[h,t] <= model.h2_cap[h]
    b.h2_cap_cons = pyo.Constraint(model.H, model.T, rule=h2_cap_rule)

    # Pipeline Transport 
    def pipe_1_rule(b, i,j, t):
        return model.pipe_in[i,j,t] <= model.pipe_flow*model.pipe_path[i,j]
    b.pipe_1_cons = pyo.Constraint(model.Pipes, model.T, rule=pipe_1_rule)

    def pipe_2_rule(b, i,j, t):
        return model.pipe_out[i,j,t] <= model.pipe_flow*model.pipe_path[i,j] 
    b.pipe_2_cons = pyo.Constraint(model.Pipes, model.T, rule=pipe_2_rule)

    def pipe_3_rule(b, i,j, t):
        if t == model.T.first():
            return model.pipe_stor[i,j,t] == 0 + model.pipe_in[i,j,t] - model.pipe_out[i,j,t]
        else:
            return model.pipe_stor[i,j,t] == model.pipe_stor[i,j,t-1] + model.pipe_in[i,j,t] - model.pipe_out[i,j,t]
    b.pipe_3_cons = pyo.Constraint(model.Pipes, model.T, rule=pipe_3_rule)

    def pipe_4_rule(b, i,j, t):
        return model.pipe_stor[i,j,t] <= model.pipe_cap*model.pipe_path[i,j]
    b.pipe_4_cons = pyo.Constraint(model.Pipes, model.T, rule=pipe_4_rule)

    # Total H2 being charged in system
    def H2_charge_rule(b, t):
        return model.H2_charge[t] == (sum(model.charge[s,t] for s in model.Stor if model.s_filter[s]=='H2')
                                      + sum(model.v_charge[v,t] for v in model.V if (model.v_filter[v]=='99H2' or model.v_filter[v]=='FCEV'))
                                      + sum(model.pipe_stor[i,j,t] for i,j in model.Pipes))
    b.H2_charge_cons = pyo.Constraint(model.T, rule=H2_charge_rule)

    # Total H2 being discharged in system
    def H2_discharge_rule(b, t):
        return model.H2_discharge[t] == (sum(model.discharge[s,t] for s in model.Stor if model.s_filter[s]=='H2')
                                         + sum(model.v_discharge[v,t] for v in model.V if (model.v_filter[v]=='99H2' or model.v_filter[v]=='FCEV')))
    b.H2_discharge_cons = pyo.Constraint(model.T, rule=H2_discharge_rule)

    # Total H2 being moved in system
    def H2_transit_rule(b, t):
        return model.H2_transit[t] == (sum((model.v_soc[v,t]*model.v_cap[model.v_filter[v]]) for v in model.V if (model.v_filter[v]=='99H2' or model.v_filter[v]=='FCEV'))
                                       + sum(model.pipe_in[i,j,t] for i,j in model.Pipes)
                                       + sum(model.pipe_out[i,j,t] for i,j in model.Pipes))
    b.H2_transit_cons = pyo.Constraint(model.T, rule=H2_transit_rule)

# -------------------------------------#
#       Electric Balance
def elec_block(b):
    model = b.model()

    # Bus balance
    def bus_balance_rule(b, bus, t):
        gen = sum(model.gen_elec[g,t] for g in model.Gen if model.gen_link[g]==bus)
        inflow = (sum((model.flow_elec[l,t]) for l in model.Line if model.r_bus[l]==bus) 
                  + sum((model.discharge[s,t] for s in model.Stor if model.stor_link[s]==bus and model.s_filter[s]=='BESS'))
                  + sum((model.sf_to_grid[sf,t] for sf in model.SF if model.solar_link[sf]==bus))
                  + sum((model.v_locdischarge[v,i,t] for v in model.V for i in model.LOC if model.loc_link[i]==bus and model.v_filter[v]=='BEV')))
        
        outflow = (sum((model.flow_elec[l,t]) for l in model.Line if model.s_bus[l]==bus) 
                   + sum((model.charge[s,t] for s in model.Stor if model.stor_link[s]==bus and model.s_filter[s]=='BESS'))
                   + sum((model.v_loccharge[v,i,t] for v in model.V for i in model.LOC if model.loc_link[i]==bus and model.v_filter[v]=='BEV')))
        demand = (model.elec_demand[bus,t] - model.elec_curtail[bus,t])
        return gen + inflow - outflow == demand
    b.bus_balance_cons = pyo.Constraint(model.Bus, model.T, rule=bus_balance_rule)

    # DC Power Flow Equations
    def dcflow_1_rule(b, l, t):
        return model.flow_elec[l,t] == (model.angle[model.s_bus[l],t] - model.angle[model.r_bus[l],t])*(100/model.reactance[l])
    b.dcflow_1_cons = pyo.Constraint(model.Line, model.T, rule=dcflow_1_rule)

    def dcflow_2_rule(b, l, t):
        return pyo.inequality(-model.maxflow_line[l],  (model.flow_elec[l,t]/100), model.maxflow_line[l])
    b.dcflow_2_cons = pyo.Constraint(model.Line, model.T, rule=dcflow_2_rule)

    # Bus angle limit
    def busangle_rule(b, bus, t):
        return pyo.inequality(model.minangle[bus], model.angle[bus,t], model.maxangle[bus])
    b.busangle_cons = pyo.Constraint(model.Bus, model.T, rule=busangle_rule)

    # Slack Bus
    def slackbus_rule(b, t):
        return model.angle['B13', t] == 0
    b.slackbus_cons = pyo.Constraint(model.T, rule=slackbus_rule)

    # Carbon flow - gen
    def cf_gen_rule(b, g, t):
        return model.cf_gen[g,t] == model.gen_elec[g,t]*model.ei_gen[g]
    b.cf_gen_cons = pyo.Constraint(model.Gen, model.T, rule=cf_gen_rule)

    # Carbon flow - load
    def cf_load_rule(b, bus, t):
        return model.cf_load[bus,t] == (model.elec_demand[bus,t] - model.elec_curtail[bus,t])*model.ei_bus[bus]
    b.cf_load_cons = pyo.Constraint(model.Bus, model.T, rule=cf_load_rule)

    # Carbon flow balance
    def cf_balance_rule(b, bus, t):
        gen = sum(model.cf_gen[g,t] for g in model.Gen if model.gen_link[g]==bus)
        inflow = (sum((model.ei_bus[bus]*model.flow_elec[l,t]) for l in model.line_in[bus]))
        outflow = sum((model.ei_bus[bus]*model.flow_elec[l,t]) for l in model.line_out[bus])
        demand = model.cf_load[bus,t]
        return gen + inflow - outflow >= demand
    b.cf_balance_cons = pyo.Constraint(model.Bus, model.T, rule=cf_balance_rule)
# -------------------------------------#
#           UC
def UC_block(b):
    model = b.model()

    #   Generation Limits
    def genlimit_1_rule(b, g, t):
        return model.gen_elec[g,t] == model.mingen_elec[g]*model.X_op[g,t] + sum(model.gen_segment[g,k,t] for k in model.eSegments)
    b.genlimit_1_cons = pyo.Constraint(model.Gen, model.T, rule=genlimit_1_rule)

    def genlimit_2_rule(b, g, k, t):
        return model.gen_segment[g,k,t] <= model.maxgen_segment[g,k]
    b.genlimit_2_cons = pyo.Constraint(model.Gen, model.eSegments, model.T, rule=genlimit_2_rule)

    def genlimit_4_rule(b,g,t):
        if t == model.T.first():
            return model.gen_elec[g,t] <= model.maxgen_elec[g]*model.X_op[g,t] + model.gen_init[g]
        return model.gen_elec[g,t] <= model.maxgen_elec[g]*model.X_op[g,t]
    b.genlimit_4_cons = pyo.Constraint(model.Gen, model.T, rule=genlimit_4_rule)

    #   Rampup limit
    def rampup_rule(b, g, t):
        if t > model.T.first():
            return (model.gen_elec[g,t] - model.gen_elec[g,t-1]) <= (model.rampup[g]*model.X_op[g,t-1]) + (model.startup[g]*model.X_su[g,t])
        return pyo.Constraint.Skip
    b.rampup_cons = pyo.Constraint(model.Gen, model.T, rule=rampup_rule)

    #   Rampdown limit
    def rampdown_rule(b, g,t):
        if t > model.T.first():
            return (model.gen_elec[g,t-1] - model.gen_elec[g,t]) <= (model.rampdown[g]*model.X_op[g,t]) + (model.shutdown[g]*model.X_sd[g,t])
        return pyo.Constraint.Skip
    b.rampdown_cons = pyo.Constraint(model.Gen, model.T, rule=rampdown_rule)

    # Uptime/Downtime restriction
    def susd_rule(b, g,t):
        if t == model.T.first():
            return model.X_su[g,t] - model.X_sd[g,t] == model.X_op[g,t] - model.X_init[g]
        else:
            return model.X_su[g,t] - model.X_sd[g,t] == model.X_op[g,t] - model.X_op[g,t-1]
    b.susd_cons = pyo.Constraint(model.Gen, model.T, rule=susd_rule)

    #   Min uptime
    def min_up_rule(b, g,t):
        UT = int(model.minon_gen[g])
        UT0 = int(model.ut_init[g])
        if t + UT - 1 > model.T.last():
            return pyo.Constraint.Skip
        if t == model.T.first():
                return sum(model.X_op[g, tau] for tau in range(t, t + UT)) + UT0 >= UT * model.X_su[g, t]
        return sum(model.X_op[g, tau] for tau in range(t, t + UT)) >= UT * model.X_su[g, t]
    b.MinUp = pyo.Constraint(model.Gen, model.T, rule=min_up_rule)

    #   Min downtime
    def min_down_rule(b, g,t):
        DT = int(model.minoff_gen[g])
        DT0 = int(model.dt_init[g])
        if t + DT - 1 > model.T.last():
            return pyo.Constraint.Skip
        if t == model.T.first():
            return sum(1-model.X_op[g, tau] for tau in range(t, t + DT)) + DT0 >= DT * (model.X_sd[g,t])
        return sum(1-model.X_op[g, tau] for tau in range(t, t + DT)) >= DT * (model.X_sd[g,t])    
    b.MinDown = pyo.Constraint(model.Gen, model.T, rule=min_down_rule)

    #   Generation costs
    def gen_cost_rule(b, g, t):
        return model.gen_costs[g,t] == (model.cc_su[g]*model.X_su[g,t]
                                         + model.cc_sd[g]*model.X_sd[g,t]
                                         + model.cc_noload[g]*model.X_op[g,t]
                                         + (sum(model.cc_segment[g,k]*model.gen_segment[g,k,t] for k in model.eSegments)))
    b.gen_cost_cons = pyo.Constraint(model.Gen, model.T, rule=gen_cost_rule)

# -------------------------------------#
#           Storage
def storage_block(b):
    model = b.model()

    # SOC
    def soc_rule(b, s, t):
        if t < model.T.last():
            return model.soc[s,t+1] == (model.soc[s,t] 
                                    + model.stor_etac[model.s_filter[s]] * (model.charge[s,t]/model.stor_cap[s])
                                    - (model.leak[model.s_filter[s]]*model.soc[s,t])
                                    - (1/model.stor_etad[model.s_filter[s]]) * (model.discharge[s,t]/model.stor_cap[s]))
        else:
            return pyo.Constraint.Skip
    b.soc_cons = pyo.Constraint(model.Stor, model.T, rule=soc_rule)

    def firstlastsoc_rule(b, s, t):
        if (t == model.T.first()) or (t == model.T.last()):
            return model.soc[s,t] == 0.3
        return pyo.Constraint.Skip
    b.firstlastsoc_cons = pyo.Constraint(model.Stor, model.T, rule=firstlastsoc_rule)

    def capacity_rule(b, s, t):
        return pyo.inequality(0, model.soc[s,t]*model.stor_cap[s], model.stor_cap[s])
    b.capacity_cons = pyo.Constraint(model.Stor, model.T, rule=capacity_rule)

    def input_rule(b, s, t):
        if t < model.T.last():
            return model.charge[s,t] <= model.stor_crate[model.s_filter[s]]*model.ch[s,t]
        return model.charge[s,t] == 0
    b.input_cons = pyo.Constraint(model.Stor, model.T, rule=input_rule)

    def output_rule(b, s, t):
        if t < model.T.last():
            return model.discharge[s,t] <= model.stor_drate[model.s_filter[s]]*model.dis[s,t]
        return model.discharge[s,t] == 0
    b.output_cons = pyo.Constraint(model.Stor, model.T, rule=output_rule)

    # One state rule
    def state_rule(b, s, t):
        return model.ch[s,t] + model.dis[s,t] <= 1
    b.state_cons = pyo.Constraint(model.Stor, model.T, rule=state_rule)

# -------------------------------------#
#           Solar-PV Powered Electrolysis
def solar_block(b):
    model = b.model()
    b.pv_pr = pyo.Param(initialize=0.8, domain=pyo.NonNegativeReals)                # Performance Ratio

    # Elec Generation
    def pv_gen_rule(b, sf, t):
        # return model.pv_gen[sf, t] == ((model.solar_rad[t])*b.pv_pr*model.pv_max[sf])
        return model.pv_gen[sf,t] == (model.pv_kw[sf,t])/1000
    b.pv_gen_cons = pyo.Constraint(model.SF, model.T, rule=pv_gen_rule)

    def sf_power_rule(b, sf, t):
        return model.pv_gen[sf,t] == model.sf_to_grid[sf,t] + model.sf_to_ely[sf,t] + model.sf_slack[sf,t]
    b.sf_power_cons = pyo.Constraint(model.SF, model.T, rule=sf_power_rule)

    # H2 Generation
    def sf_ely_gen_rule(b, sf, t):
        return model.H2_SF[sf,t] == (model.sf_to_ely[sf,t]*model.ely_efficiency)
    b.sf_ely_gen_cons = pyo.Constraint(model.SF, model.T, rule=sf_ely_gen_rule)

# -------------------------------------#
#           TESS 
def tess_block(b):
    model = b.model()

    #   Transportation
    def tau_init(b, v, i,j):
        return int((pyo.value(model.paths_distance[i,j]) + int(model.v_speed[model.v_filter[v]]) - 1) // int(model.v_speed[model.v_filter[v]]))
    b.tau = pyo.Param(model.V, model.Paths, initialize=tau_init)

    def vehicle_start_rule(b, v):
        return model.vx_loc[v, model.T.first(), model.v_initloc[v]] == 1
    b.vehicle_start_cons = pyo.Constraint(model.V, rule=vehicle_start_rule)

    def vehicle_legal_rule(b, v, i, j, t):
        return model.vx_move[v,i,j,t] <= model.paths_X[i,j]
    b.vehicle_legal_cons = pyo.Constraint(model.V, model.Paths, model.T, rule=vehicle_legal_rule)

    def move_or_stay_rule(b, v, t):
        return sum(model.vx_loc[v,t,i] for i in model.Facility) + model.vx_transit[v,t] == 1
    b.move_or_stay_cons = pyo.Constraint(model.V, model.T, rule=move_or_stay_rule)

    def vehicle_loc_rule(b, v, i, j, t):
        return model.vx_move[v,i,j,t] <= model.vx_loc[v,t,i]
    b.vehicle_loc_cons = pyo.Constraint(model.V, model.Paths, model.T, rule=vehicle_loc_rule)

    def arrival_rule(b, v, i, j, t):
        tt = pyo.value(b.tau[v,i,j])
        if t + tt <= model.T.last():
            return model.vx_loc[v,t+tt,j] >= model.vx_move[v,i,j,t]
        else:
            return model.vx_move[v,i,j,t] == 0
    b.arrival_cons = pyo.Constraint(model.V, model.Paths, model.T, rule=arrival_rule)

    def move_rule(b, v, t):
        return sum(model.vx_move[v,i,j,t] for (i,j) in model.Paths) <= 1
    b.move_cons = pyo.Constraint(model.V, model.T, rule=move_rule)

    def vehicle_cost_rule(b, v, t):
        return model.v_cost[v,t] == sum(model.vx_move[v,i,j,t]*model.paths_distance[i,j] 
                                        for (i,j) in model.Paths)*model.v_cc[model.v_filter[v]]
    b.vehicle_cost_cons = pyo.Constraint(model.V, model.T, rule=vehicle_cost_rule)

    # Hub Docking 
    def v_dock_rule(b, i, t):
        return model.p_dockcap[i] >= sum(model.vx_dock[v, i, t] for v in model.V)
    b.v_dock_cons = pyo.Constraint(model.Facility, model.T, rule=v_dock_rule)

    def dock_loc_rule(b, v, i, t):
        return model.vx_dock[v,i,t] <= model.vx_loc[v,t,i]
    b.dock_loc_cons = pyo.Constraint(model.V, model.Facility, model.T, rule=dock_loc_rule)

    #   SOC
    def v_soc_rule(b, v, t):
        if t < model.T.last():
            return model.v_soc[v,t+1] == (model.v_soc[v,t] + model.v_etac[model.v_filter[v]] * (model.v_charge[v,t]/model.v_cap[model.v_filter[v]]) - (1/model.v_etad[model.v_filter[v]]) * (model.v_discharge[v,t]/model.v_cap[model.v_filter[v]]) 
                                       - ((sum((model.paths_distance[i,j]*model.vx_move[v,i,j,t] for (i,j) in model.Paths))*(1/model.v_etau[model.v_filter[v]])*model.v_unitfuel[model.v_filter[v]]))
                                       - ((sum((model.shift_distance[s]*model.shift_x[s,v,t] for s in model.Shifts))*(1/model.v_etau[model.v_filter[v]])*model.v_unitfuel[model.v_filter[v]])))
        return pyo.Constraint.Skip
    b.v_soc_cons = pyo.Constraint(model.V, model.T, rule=v_soc_rule)

    def v_firstlastsoc_rule(b, v, t):
        if (t == model.T.first()) or (t == model.T.last()):
            return model.v_soc[v,t] == 0.5
        return pyo.Constraint.Skip
    b.v_firstlastsoc_cons = pyo.Constraint(model.V, model.T, rule=v_firstlastsoc_rule)

    def v_cap_rule(b,v,t):
        return pyo.inequality(0, model.v_soc[v,t]*model.v_cap[model.v_filter[v]], model.v_cap[model.v_filter[v]])
    b.v_cap_cons = pyo.Constraint(model.V, model.T, rule=v_cap_rule)

    def vehicle_inputcap_rule(b,v,t):
        if t < model.T.last():
            return model.v_charge[v,t] <= model.v_charge_rate[model.v_filter[v]]*model.vx_ch[v,t]
        return model.v_charge[v,t] == 0
    b.vehicle_inputcap_cons = pyo.Constraint(model.V, model.T, rule=vehicle_inputcap_rule)

    def vehicle_inputloc_rule(b, v, i, t):
        return model.v_loccharge[v,i,t] <= model.v_charge_rate[model.v_filter[v]]*model.vx_dock[v,i,t]
    b.vehicle_inputloc_cons = pyo.Constraint(model.V, model.Facility, model.T, rule=vehicle_inputloc_rule)

    def vehicle_inputsum_rule(b, v, t):
        return model.v_charge[v,t] <= sum(model.v_loccharge[v,i,t] for i in model.Facility)
    b.vehicle_inputsum_cons = pyo.Constraint(model.V, model.T, rule=vehicle_inputsum_rule)

    def vehicle_outputcap_rule(b,v,t):
        if t < model.T.last():
            return model.v_discharge[v,t] <= model.v_discharge_rate[model.v_filter[v]]*model.vx_dis[v,t]
        return pyo.Constraint.Skip
    b.vehicle_outputcap_cons = pyo.Constraint(model.V, model.T, rule=vehicle_outputcap_rule)

    def vehicle_outputloc_rule(b, v, i, t):
        return model.v_locdischarge[v,i,t] <= model.v_discharge_rate[model.v_filter[v]]*model.vx_dock[v,i,t]
    b.vehicle_outputloc_cons = pyo.Constraint(model.V, model.Facility, model.T, rule=vehicle_outputloc_rule)

    def vehicle_outputsum_rule(b, v, t):
        return model.v_discharge[v,t] <= sum(model.v_locdischarge[v,i,t] for i in model.Facility)
    b.vehicle_outputsum_cons = pyo.Constraint(model.V, model.T, rule=vehicle_outputsum_rule)

    # One state rule 
    def v_state_rule(b, v,t):
        return model.vx_ch[v,t] + model.vx_dis[v,t] <= sum(model.vx_dock[v,i,t] for i in model.Facility)
    b.v_state_cons = pyo.Constraint(model.V, model.T, rule=v_state_rule)

    #   Shifts
    def shift_loc_rule(b, s, v, t):
        if model.v_filter[v] == 'BESS' or (model.v_filter[v] == 'FCEV'):
            if t == pyo.value(model.shift_start[s]) or t == pyo.value(model.shift_end[s]):
                return model.vx_loc[v,t,model.shift_loc[s]] >= model.shift_x[s,v,model.shift_start[s]]
            return pyo.Constraint.Skip
        return pyo.Constraint.Skip
    b.shift_loc_cons = pyo.Constraint(model.Shifts, model.V, model.T, rule=shift_loc_rule)

    def shift_transit_rule(b, s, v, t):
        if model.v_filter[v] == 'BESS' or (model.v_filter[v] == 'FCEV'):
            if t > pyo.value(model.shift_start[s]) and t < pyo.value(model.shift_end[s]):
                return model.vx_transit[v,t] >= model.shift_x[s,v,model.shift_start[s]]
            return pyo.Constraint.Skip   
        return pyo.Constraint.Skip
    b.shift_transit_cons = pyo.Constraint(model.Shifts, model.V, model.T, rule=shift_transit_rule)

    def shift_cap_rule(b,s):
        return sum(model.shift_x[s,v,t] for v in model.V for t in model.T) == 1
    b.shift_cap_cons = pyo.Constraint(model.Shifts, rule=shift_cap_rule)

    def shift_time_rule(b, s, v, t):
        if t != pyo.value(model.shift_start[s]):
            return model.shift_x[s,v,t] == 0
        return model.shift_x[s,v,t] <= 1
    b.shift_time_cons = pyo.Constraint(model.Shifts, model.V, model.T, rule=shift_time_rule)

# -------------------------------------#
#           Railway
def railway_block(b):
    model = b.model()

    # Railway Loading/Unloading
    def railway_cap_rule(b, r, t):
        return pyo.inequality (0, model.rw_soc[r,t]*model.rw_cap, model.rw_cap)
    b.railway_cap_cons = pyo.Constraint(model.RW, model.T, rule=railway_cap_rule)

    def railway_soc_rule(b, r, t):
        if t < model.T.last():
            return model.rw_soc[r,t+1] == (model.rw_soc[r,t] + (model.rw_load[r,t]/model.rw_cap)
                                           - (model.rw_unload[r,t]/model.rw_cap) - (model.rw_soc[r,t]*model.rw_degrade))
        return pyo.Constraint.Skip
    b.railway_soc_cons = pyo.Constraint(model.RW, model.T, rule=railway_soc_rule)

    def rail_firstlastsoc_rule(b, r, t):
        if (t == model.T.first()) or (t == model.T.last()):
            return model.rw_soc[r,t] == 0.2
        return pyo.Constraint.Skip
    b.rail_firstlastsoc_cons = pyo.Constraint(model.RW, model.T, rule=rail_firstlastsoc_rule)

    def rail_loadcap_rule(b, r, t):
            return model.rw_load[r,t] <= model.rw_throughput
    b.rail_loadcap_cons = pyo.Constraint(model.RW, model.T, rule=rail_loadcap_rule)

    def rail_unloadcap_rule(b, r, t):
            return model.rw_unload[r,t] <= model.rw_throughput
    b.rail_unloadcap_cons = pyo.Constraint(model.RW, model.T, rule=rail_unloadcap_rule)

    # def rw_load_rule(b, r, t):
    #     if t < model.T.last():
    #         return model.rw_load[r,t] <= sum(model.loc_supply[i,t] for i in model.Stations if model.rw_path[r,t]==i)
    #     return model.rw_load[r,t] == 0
    # b.rw_load_cons = pyo.Constraint(model.RW, model.T, rule=rw_load_rule)

    # def rw_unload_rule(b, r, t):
    #     if t < model.T.last():
    #         return model.rw_unload[r,t] <= sum(model.loc_demand[i,t] for i in model.Stations if model.rw_path[r,t]==i)
    #     return model.rw_unload[r,t] == 0
    # b.rw_unload_cons = pyo.Constraint(model.RW, model.T, rule=rw_unload_rule)

    def rail_cost_rule(b, r, t):
        return model.rw_cost[r,t] == model.rw_cc*(model.rw_load[r,t] + model.rw_unload[r,t])
    b.rail_cost_cons = pyo.Constraint(model.RW, model.T, rule=rail_cost_rule)
# -------------------------------------#
#           Carbon Capture Storage and Accounting
def ccsplant_block(b):
    model = b.model()

    def emission_plant1_rule(b, p):
        return model.emission_plant[p, model.T.first()] == 0
    b.emission_plant1_cons = pyo.Constraint(model.P, rule=emission_plant1_rule)

    def emission_plant2_rule(b, p, t):
        consuming = [r for (pl,r) in model.PlantProcess if pl == p]
        if len(consuming) == 0:
            return pyo.Constraint.Skip
        if t < model.T.last():
            consumption = sum(model.process_res[p,r,t] for r in consuming)
            return model.emission_plant[p,t+1] == (model.eta_k*model.emission_plant[p,t] 
                                                   + (model.ei_plant[model.pfilter[p]]*consumption))
        return pyo.Constraint.Skip
    b.emission_plant2_cons = pyo.Constraint(model.P, model.T, rule=emission_plant2_rule)

# -------------------------------------#
def ccsvehicle_block(b):
    model = b.model()

    def emission_vehicle1_rule(b, v):
        return model.emission_vehicle[v,model.T.first()] == 0
    b.emission_vehicle1_cons = pyo.Constraint(model.V, rule=emission_vehicle1_rule)

    def emission_vehicle2_rule(b, v, t):
        if t < model.T.last():
            return model.emission_vehicle[v,t+1] == (model.eta_k*model.emission_vehicle[v,t] 
                                                    #  + (model.ei_vehicle[model.v_filter[v]]*((sum(model.paths_distance[i,j]*model.vx_move[v,i,j,t] for (i,j) in model.Paths))*(1/model.v_etau[model.v_filter[v]])*model.v_unitfuel[model.v_filter[v]]))
                                                    + (model.ei_vehicle[model.v_filter[v]]*model.v_charge[v,t]*model.v_etac[model.v_filter[v]])
                                                    - (model.ei_vehicle[model.v_filter[v]]*model.v_discharge[v,t]*model.v_etad[model.v_filter[v]]))
        return pyo.Constraint.Skip
    b.emission_vehicle2_cons = pyo.Constraint(model.V, model.T, rule=emission_vehicle2_rule)

# -------------------------------------#
def ccsstor_block(b):
    model = b.model()

    def emission_stor1_rule(b, s):
        return model.emission_stor[s,model.T.first()] == 0
    b.emission_stor1_cons = pyo.Constraint(model.Stor, rule=emission_stor1_rule)

    def emission_stor2_rule(b, s, t):
        if model.s_filter[s] == 'H2':
            return pyo.Constraint.Skip
        if t < model.T.last():
            return model.emission_stor[s,t+1] == (model.eta_k*model.emission_stor[s,t] 
                                                  + (model.ei_bus[model.stor_link[s]]*model.charge[s,t]*model.stor_etac[model.s_filter[s]])
                                                  - (model.ei_stor[model.s_filter[s]]*model.discharge[s,t]*model.stor_etad[model.s_filter[s]]))
        return pyo.Constraint.Skip
    b.emission_stor2_cons = pyo.Constraint(model.Stor, model.T, rule=emission_stor2_rule)

# -------------------------------------#
#           Pricing


#--------------Model Definition--------------#
def build_model():

    model = pyo.ConcreteModel()

    # Global Sets
    model.Facility = pyo.Set(initialize=johor['Facility'].dropna().tolist())
    model.T = pyo.Set(ordered=True, initialize=power['Time'].dropna().astype(int).tolist())                                        # Set of time periods (hours)
    model.P = pyo.Set(initialize=pp['Plant'].dropna().tolist(), within=model.Facility)                                     # Set of processing plants in the system
    model.P_type = pyo.Set(initialize=['POM','WWTP','BSP','BHH','RW'])                                   # Set of processing plant type
    model.Process = pyo.Set(initialize=['AD','DPCF','SMR','Gas','Pur'])                             # Set of processes in system
    model.Material = pyo.Set(initialize=['POME','Biogas','Biomass','BioH2','99H2'])                 # Set of materials in system
    model.PlantProcess = pyo.Set(dimen=2, initialize=list(pp[['Plant Index','Plant Process']].dropna().itertuples(index=False, name=None)))
                                                                                                    # Set of processes available per plant
    model.Bus = pyo.Set(initialize=power['Bus'].dropna().tolist())                                  # Set of power buses
    model.SF = pyo.Set(initialize=sf['Solar Farms'].dropna().tolist(), within=model.Facility)                              # Set of Solar Farms
    model.Gen = pyo.Set(initialize=power['Generator'].dropna().tolist())                            # Set of power units 
    model.Line = pyo.Set(initialize=power['Line'].dropna().tolist())                                # Set of power lines
    model.Stor = pyo.Set(initialize=storage['Unit'].dropna().tolist())                              # Set of storage units
    model.Stor_type = pyo.Set(initialize=['BESS','H2'])                                      # Set of storage unit types
    model.eSegments = pyo.RangeSet(1,5)                                                             # Set of segments for piecewise linear power generation  
    model.RW = pyo.Set(initialize=train['Trains'].dropna().tolist())                                # Set of trains in system
    model.Stations = pyo.Set(initialize=train['Stations'].dropna().tolist(), within=model.Facility)                        # Set of train stations
    model.V = pyo.Set(initialize=tess['Vehicle'].dropna().tolist())
    model.V_type = pyo.Set(initialize=['POME','Biogas','Biomass','BioH2','99H2', 'BEV', 'FCEV'])
    model.H = pyo.Set(initialize=h2['Unit'].dropna().to_list(), within=model.Facility)
    model.Paths = pyo.Set(initialize=model.Facility*model.Facility, dimen=2, within=model.Facility*model.Facility)
    model.Shifts = pyo.Set(initialize=tess['Shift'].dropna().tolist())
    model.Pipes = pyo.Set(initialize=model.H*model.H, dimen=2, within=model.H*model.H)
    model.LOC = pyo.Set(initialize=tess['Location'].dropna().tolist(), within=model.Facility)
    model.S = pyo.Set(initialize=(model.Bus | model.H), within=(model.Bus | model.H))

    # Initialising lines connecting buses
    model.line_in = pyo.Set(model.Bus)
    model.line_out = pyo.Set(model.Bus)
    model.r_bus = pyo.Param(model.Line,initialize=power.set_index('Line')['End Bus'].dropna().to_dict(), within=model.Bus)
    model.s_bus = pyo.Param(model.Line, initialize=power.set_index('Line')['Start Bus'].dropna().to_dict(), within=model.Bus)
    for l in model.Line:
        model.line_in[model.r_bus[l]].add(l)
        model.line_out[model.s_bus[l]].add(l)

    # Plant Process Block Data
    model.pfilter = pyo.Param(model.P, initialize=pp.set_index('Plant')['Plant Type'].dropna().to_dict(), within=model.P_type)
    model.plant_mincap = pyo.Param(model.PlantProcess, initialize=pp.set_index(['Plant Index','Plant Process'])['Plant Min Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.plant_maxcap = pyo.Param(model.PlantProcess, initialize=pp.set_index(['Plant Index','Plant Process'])['Plant Max Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.stoich = pyo.Param(model.Process, initialize=pp.set_index('Process Index')['Process Stoich'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.material_in = pyo.Param(model.Process,initialize=pp.set_index('Process Index')['Material Input'].dropna().to_dict(), within=model.Material)
    model.material_out = pyo.Param(model.Process,initialize=pp.set_index('Process Index')['Material Output'].dropna().to_dict(), within=model.Material)
    model.init_inven = pyo.Param(model.P, model.Material, initialize=pp.set_index(['Plant Mat Index','Material Index'])['Initial Inventory'].dropna().to_dict(), default=0, within=pyo.NonNegativeReals)
    model.mat_cap = pyo.Param(model.P_type, model.Material, initialize=pp.set_index(['Type Index','Mat Cap Index'])['Material Cap'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.plant_inven = pyo.Var(model.P, model.Material, model.T, within=pyo.NonNegativeReals)
    model.process_res = pyo.Var(model.PlantProcess, model.T, within=pyo.NonNegativeReals)


    # H2 Balance Block Data
    model.h2_demand = pyo.Param(model.H, initialize=h2.set_index('Unit')['Demand'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.h2_cap = pyo.Param(model.H, initialize=h2.set_index('Unit')['Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.pipe_cap = pyo.Param(initialize=5, within=pyo.NonNegativeReals)
    model.pipe_flow = pyo.Param(initialize=5, within=pyo.NonNegativeReals)
    model.pipe_path = pyo.Param(model.Pipes, initialize=pipe.stack().to_dict(), within=pyo.Binary)
    model.h2_inven = pyo.Var(model.H, model.T, within=pyo.NonNegativeReals)
    model.h2_balance = pyo.Var(model.H, within=pyo.NonNegativeReals)
    model.pipe_in = pyo.Var(model.H, model.H, model.T, within=pyo.NonNegativeReals)
    model.pipe_out = pyo.Var(model.H, model.H, model.T, within=pyo.NonNegativeReals)
    model.pipe_stor = pyo.Var(model.H, model.H, model.T, within=pyo.NonNegativeReals)
    model.H2_charge = pyo.Var(model.T, within=pyo.NonNegativeReals)
    model.H2_discharge = pyo.Var(model.T, within=pyo.NonNegativeReals)
    model.H2_transit = pyo.Var(model.T, within=pyo.NonNegativeReals)

    # Electrical Power Block Data
    model.maxangle = pyo.Param(model.Bus, initialize=power.set_index('Bus')['Max Angle'].dropna().to_dict(), within=pyo.Reals)
    model.minangle = pyo.Param(model.Bus, initialize=power.set_index('Bus')['Min Angle'].dropna().to_dict(),within=pyo.Reals)
    model.maxflow_line = pyo.Param(model.Line, initialize=power.set_index('Line')['Line Capacity'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.reactance = pyo.Param(model.Line, initialize=power.set_index('Line')['Line X'].dropna().to_dict(),within=pyo.Reals)
    model.eleclf = pyo.Param(model.Bus, initialize=power.set_index('Bus')['Load Factor'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.elecdemand = pyo.Param(model.T, initialize=power.set_index('Time')['Elec Demand'].dropna().to_dict(),within=pyo.NonNegativeReals)

    bus_demand = {}
    for t in model.T:
        for b in model.Bus:
            bus_demand[b,t] = model.elecdemand[t]*model.eleclf[b]
    model.elec_demand = pyo.Param(model.Bus, model.T, initialize=bus_demand, within=pyo.NonNegativeReals)
    model.ei_bus = pyo.Param(model.Bus, initialize=power.set_index('Bus')['EI Bus'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.ei_gen = pyo.Param(model.Gen, initialize=power.set_index('Generator')['EI Gen'].dropna().to_dict(), within=pyo.NonNegativeReals)
    
    model.gen_elec = pyo.Var(model.Gen, model.T, within=pyo.NonNegativeReals)
    model.flow_elec = pyo.Var(model.Line, model.T, within=pyo.Reals)
    model.angle = pyo.Var(model.Bus, model.T, within=pyo.Reals)
    model.elec_curtail = pyo.Var(model.Bus, model.T, within=pyo.NonNegativeReals)
    model.cf_gen = pyo.Var(model.Gen, model.T, within=pyo.Reals)
    model.cf_load = pyo.Var(model.Bus, model.T, within=pyo.Reals)


    # Unit Commitment Block Data
    model.gen_link = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Gen Bus'].dropna().to_dict(), within=model.Bus)
    model.mingen_elec = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Min Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.maxgen_elec = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Max Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.c = pyo.Param(model.Gen, initialize=power.set_index('Generator')['c'].dropna().to_dict())
    model.b = pyo.Param(model.Gen, initialize=power.set_index('Generator')['b'].dropna().to_dict())
    model.a = pyo.Param(model.Gen, initialize=power.set_index('Generator')['a'].dropna().to_dict())

    cost_segment = {}
    set_max = {}
    # Piece-wise cost calculation
    for g in model.Gen:
        Pmin = float(model.mingen_elec[g])
        Pmax = float(model.maxgen_elec[g])
        K = 5
        dp = (Pmax - Pmin) / K
        P = [Pmin + k*dp for k in range(K+1)]
        a = float(model.a[g])
        b = float(model.b[g])
        c = float(model.c[g])

        def C(p):
            return a*p**2 + b*p + c
        
        for k in range(1, K+1):
            cost_segment[(g,k)] = (C(P[k]) - C(P[k-1])) / dp
            set_max[(g,k)] = dp

    model.cc_segment = pyo.Param(model.Gen, model.eSegments, initialize=cost_segment, within=pyo.NonNegativeReals, default=0)
    model.cc_noload = pyo.Param(model.Gen, initialize=power.set_index('Generator')['No Load CC'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.cc_su = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Startup CC'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.cc_sd = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Shutdown CC'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.minon_gen = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Min Ontime'].dropna().to_dict(), within=pyo.NonNegativeIntegers)
    model.minoff_gen = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Min Offtime'].dropna().to_dict(), within=pyo.NonNegativeIntegers)
    model.rampup = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Rampup'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.rampdown = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Rampdown'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.maxgen_segment = pyo.Param(model.Gen, model.eSegments, initialize=set_max, within=pyo.NonNegativeReals, default=0)
    model.X_init = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Init X'].dropna().to_dict(), within=pyo.Binary)
    model.gen_init = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Power Initial'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.t_init = pyo.Param(model.Gen, initialize=power.set_index('Generator')['T Initial'].dropna().to_dict(), within=pyo.Integers)    
    ut_start = {}
    dt_start = {}
    for g in model.Gen:
        tau = int(model.t_init[g])
        if tau >= 0:
            ut_start[g] = tau
            dt_start[g] = 0
        else:
            ut_start[g] = 0
            dt_start[g] = -1*tau
    
    model.ut_init = pyo.Param(model.Gen, initialize=ut_start, within=pyo.NonNegativeIntegers)
    model.dt_init = pyo.Param(model.Gen, initialize=dt_start, within=pyo.NonNegativeIntegers)
    model.startup = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Startup Limit'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.shutdown = pyo.Param(model.Gen, initialize=power.set_index('Generator')['Shutdown Limit'].dropna().to_dict(),within=pyo.NonNegativeReals)

    model.X_op = pyo.Var(model.Gen, model.T, within=pyo.Binary)
    model.X_su = pyo.Var(model.Gen, model.T, within=pyo.Binary)
    model.X_sd = pyo.Var(model.Gen, model.T, within=pyo.Binary)
    model.gen_segment = pyo.Var(model.Gen, model.eSegments, model.T, within=pyo.NonNegativeReals)
    model.gen_costs = pyo.Var(model.Gen, model.T, within=pyo.NonNegativeReals)


    # Storage Block Data
    model.s_filter = pyo.Param(model.Stor, initialize=storage.set_index('Unit')['Type'].dropna().to_dict(),within=model.Stor_type)
    model.stor_cap = pyo.Param(model.Stor, initialize=storage.set_index('Unit')['Capacity'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.loc_link = pyo.Param(model.LOC, initialize=tess.set_index('Location')['Location Bus'].dropna().to_dict(), within=model.Bus)
    crate_data = {'BESS' : 35, 'H2': 25}
    model.stor_crate = pyo.Param(model.Stor_type, initialize=crate_data, within=pyo.NonNegativeReals)
    drate_data = {'BESS' : 40, 'H2': 30}
    model.stor_drate = pyo.Param(model.Stor_type, initialize=drate_data, within=pyo.NonNegativeReals)
    etac_data = {'BESS' : 0.6, 'H2' : 0.91}
    model.stor_etac = pyo.Param(model.Stor_type, initialize=etac_data, within=pyo.NonNegativeReals)
    etad_data = {'BESS' : 0.8, 'H2' : 0.95}
    model.stor_etad = pyo.Param(model.Stor_type, initialize=etad_data, within=pyo.NonNegativeReals)
    leak_data = {'BESS' : 0.05, 'H2' : 0.02} # elec dissipation, h2 leakage, boil off loss
    model.leak = pyo.Param(model.Stor_type, initialize=leak_data, within=pyo.NonNegativeReals)
    effort_data = {'BESS' : 1, 'H2': 1.2} # nothing, compression factor, liquefaction factor
    model.effort = pyo.Param(model.Stor_type, initialize=effort_data, within=pyo.NonNegativeReals)
    model.stor_link = pyo.Param(model.Stor, initialize=storage.set_index('Unit')['Stor Bus'].dropna().to_dict(),within=model.S)

    model.soc = pyo.Var(model.Stor, model.T, within=pyo.NonNegativeReals)               
    model.charge = pyo.Var(model.Stor, model.T, within=pyo.NonNegativeReals)                     
    model.discharge = pyo.Var(model.Stor, model.T, within=pyo.NonNegativeReals)          
    model.ch = pyo.Var(model.Stor, model.T, within=pyo.Binary)
    model.dis = pyo.Var(model.Stor, model.T, within=pyo.Binary)

    # TESS Block Data
    model.v_filter = pyo.Param(model.V, initialize=tess.set_index('Vehicle')['Vehicle Type'].dropna().to_dict(),within=model.V_type)
        # Vehicles
    model.v_initloc = pyo.Param(model.V, initialize=tess.set_index('Vehicle')['Initial Loc'].dropna().to_dict(), within=model.Facility)
    v_cc = {'POME' : 7e-5, 'Biogas' : 7e-5, 'Biomass' : 7e-5, 'BioH2': 7e-5, '99H2': 7e-5, 'BEV': 3e-3, 'FCEV': 2e-2}
    model.v_cc = pyo.Param(model.V_type, initialize=v_cc, within=pyo.NonNegativeReals)
    v_speed = {'POME' : 60, 'Biogas' : 60, 'Biomass' : 60, 'BioH2': 40, '99H2': 40, 'BEV': 80, 'FCEV': 80}
    model.v_speed = pyo.Param(model.V_type, initialize=v_speed, within=pyo.NonNegativeReals)
    v_cap = {'POME' : 25, 'Biogas' : 1, 'Biomass' : 30, 'BioH2': 1, '99H2': 1, 'BEV': 0.442, 'FCEV': 0.050}
    model.v_cap = pyo.Param(model.V_type, initialize=v_cap, within=pyo.NonNegativeReals)
    v_crate = {'POME' : 25, 'Biogas' : 1, 'Biomass' : 30, 'BioH2': 1, '99H2': 1, 'BEV': 0.38, 'FCEV': 0.05}
    model.v_charge_rate = pyo.Param(model.V_type, initialize=v_crate, within=pyo.NonNegativeReals)
    v_drate = {'POME' : 25, 'Biogas' : 1, 'Biomass' : 30, 'BioH2': 1, '99H2': 1, 'BEV': 0.38, 'FCEV': 0.05}
    model.v_discharge_rate = pyo.Param(model.V_type, initialize=v_drate, within=pyo.NonNegativeReals)
    v_etac = {'POME' : 0.7, 'Biogas' : 0.7, 'Biomass' : 0.7, 'BioH2': 0.8, '99H2': 0.8, 'BEV': 0.8, 'FCEV': 0.9}
    model.v_etac = pyo.Param(model.V_type, initialize=v_etac, within=pyo.NonNegativeReals)
    v_etad = {'POME' : 0.7, 'Biogas' : 0.7, 'Biomass' : 0.7, 'BioH2': 0.8, '99H2': 0.8, 'BEV': 0.8, 'FCEV': 0.8}
    model.v_etad = pyo.Param(model.V_type, initialize=v_etad, within=pyo.NonNegativeReals)
    v_etau = {'POME' : 1, 'Biogas' : 1, 'Biomass' : 1, 'BioH2': 1, '99H2': 1, 'BEV': 0.95, 'FCEV': 0.98}
    model.v_etau = pyo.Param(model.V_type, initialize=v_etau, within=pyo.NonNegativeReals)
    v_unitconsume = {'POME' : 0, 'Biogas' : 0, 'Biomass' : 0, 'BioH2': 0, '99H2': 0, 'BEV': 0.001, 'FCEV': 7e-5}
    model.v_unitfuel = pyo.Param(model.V_type, initialize=v_unitconsume, within=pyo.NonNegativeReals)
    fuel_costs = {'POME' : 0, 'Biogas' : 0, 'Biomass' : 0, 'BioH2': 0, '99H2': 0, 'BEV': 4, 'FCEV': 5}
    model.v_ccfuel = pyo.Param(model.V_type, initialize=fuel_costs, within=pyo.NonNegativeReals)
        # Locations and Pathways
    model.paths_X = pyo.Param(model.Paths, initialize=pathx.stack().to_dict(), within=pyo.Binary)
    model.paths_distance = pyo.Param(model.Paths, initialize=pathd.stack().to_dict(), within=pyo.NonNegativeReals)
    model.p_dockcap = pyo.Param(model.Facility, initialize=johor.set_index('Facility')['Dock Cap'].dropna().to_dict(),within=pyo.NonNegativeIntegers)
        # PT Shifts
    model.shift_start = pyo.Param(model.Shifts, initialize=tess.set_index('Shift')['Shift Start'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.shift_end = pyo.Param(model.Shifts, initialize=tess.set_index('Shift')['Shift End'].dropna().to_dict(), within=pyo.NonNegativeReals)
    model.shift_loc = pyo.Param(model.Shifts, initialize=tess.set_index('Shift')['Shift LOC'].dropna().to_dict(), within=model.LOC)
    model.shift_distance = pyo.Param(model.Shifts, initialize=tess.set_index('Shift')['Shift Distance'].dropna().to_dict(), within=pyo.NonNegativeIntegers)

    # Road Vehicles
    model.vx_dock = pyo.Var(model.V, model.Facility, model.T, within=pyo.Binary)
    model.vx_move = pyo.Var(model.V, model.Paths, model.T, within=pyo.Binary)
    model.vx_loc = pyo.Var(model.V, model.T, model.Facility, within=pyo.Binary)
    model.v_soc = pyo.Var(model.V, model.T, within=pyo.NonNegativeReals)
    model.v_loccharge = pyo.Var(model.V, model.Facility, model.T, within=pyo.NonNegativeReals)
    model.v_locdischarge = pyo.Var(model.V, model.Facility, model.T, within=pyo.NonPositiveReals)
    model.v_charge = pyo.Var(model.V, model.T, within=pyo.NonNegativeReals)
    model.v_discharge = pyo.Var(model.V, model.T, within=pyo.NonNegativeReals)
    model.vx_ch = pyo.Var(model.V, model.T, within=pyo.Binary)
    model.vx_dis = pyo.Var(model.V, model.T, within=pyo.Binary)
    model.v_cost = pyo.Var(model.V, model.T, within=pyo.NonNegativeReals)
    model.vx_transit = pyo.Var(model.V, model.T, within=pyo.Binary)
        # Routes
    model.shift_x = pyo.Var(model.Shifts, model.V, model.T, within=pyo.Binary)


    # Railway Block Data
    model.rw_cap = pyo.Param(initialize=1000, within=pyo.NonNegativeReals)
    model.rw_throughput = pyo.Param(initialize=1000, within=pyo.NonNegativeReals)
    model.rw_degrade = pyo.Param(initialize=0.03, within=pyo.NonNegativeReals)
    model.rw_cc = pyo.Param(initialize=0.2, within=pyo.NonNegativeReals)
    model.rw_path = pyo.Param(model.RW, model.T, initialize=train.set_index(['RW Index','Time Index'])['RW Path'].dropna().to_dict(),default=None)

    model.rw_load = pyo.Var(model.RW, model.T, within=pyo.NonNegativeReals)
    model.rw_unload = pyo.Var(model.RW, model.T, within=pyo.NonNegativeReals)
    model.rw_soc = pyo.Var(model.RW, model.T, within=pyo.NonNegativeReals)
    model.rw_cost = pyo.Var(model.RW, model.T, within=pyo.NonNegativeReals)


    # Solar Block Data
    model.ely_efficiency = pyo.Param(initialize=0.2, within=pyo.NonNegativeReals)
    model.solar_link = pyo.Param(model.SF, initialize=sf.set_index('Solar Farms')['SF Bus'].dropna().to_dict(),within=model.Bus)
    # model.solar_rad = pyo.Param(model.T, initialize=solar.set_index('Time')['insolation_kwh_m2'].dropna().to_dict(), domain=pyo.NonNegativeReals)                   # Solar Irradiation in kWh/m^2
    model.pv_kw = pyo.Param(model.SF, model.T, initialize=sf.set_index(['SF Index','Time Index'])['Site Power'].dropna().to_dict(),within=pyo.NonNegativeReals)
    model.pv_gen = pyo.Var(model.SF, model.T, within=pyo.NonNegativeReals)                        # Energy generated (kWh)
    model.H2_SF = pyo.Var(model.SF, model.T, within=pyo.NonNegativeReals)                         # H2 generated from solar powered electrolysers
    model.sf_to_grid = pyo.Var(model.SF, model.T, within=pyo.NonNegativeReals)                    # PV Power to grid (kW)
    model.sf_to_ely = pyo.Var(model.SF, model.T, within=pyo.NonNegativeReals)                     # PV Power used by electrolyser (kW)
    model.sf_slack = pyo.Var(model.SF, model.T, within=pyo.NonNegativeReals)


    # CCS Block Data
    # Pre-processing
    plantCO2_data = {'WWTP': 6.4, 'BSP': 5.59, 'BHH': 19.2, 'POM':0, 'RW':0}    # WWTP, BSP, BHH
    model.ei_plant = pyo.Param(model.P_type, initialize=plantCO2_data, within=pyo.NonNegativeReals)
    # Storage
    storCO2_data = {'BESS': 0.002, 'H2': 0.9225}   # Gas tank
    model.ei_stor = pyo.Param(model.Stor_type, initialize=storCO2_data, within=pyo.NonNegativeReals)
    # Transport
    vehicleCO2_data = {'POME': 1.05e-4, 'Biomass': 1.05e-4, 'Biogas':1.05e-4, 'BioH2': 6.5e-5, '99H2': 6.5e-5, 'BEV': 0.4e-4, 'FCEV': 0.1e-4}
    model.ei_vehicle = pyo.Param(model.V_type, initialize=vehicleCO2_data, within=pyo.NonNegativeReals)
    model.eta_ccs = pyo.Param(initialize=0.9, within=pyo.NonNegativeReals)                      # CO2 capture efficiency
    model.eta_k = pyo.Param(initialize=0.99, within=pyo.NonNegativeReals)

    model.emission_vehicle = pyo.Var(model.V, model.T, within=pyo.Reals)
    model.emission_plant = pyo.Var(model.P, model.T, within=pyo.Reals)
    model.emission_stor = pyo.Var(model.Stor, model.T, within=pyo.Reals)

    # Block Instancing
    model.plant = pyo.Block(rule=plantprocess_block)
    model.h2 = pyo.Block(rule=h2balance_block)
    model.store = pyo.Block(rule=storage_block)
    model.gens = pyo.Block(rule=UC_block)
    model.elecbus = pyo.Block(rule=elec_block)
    model.vroom = pyo.Block(rule=tess_block)
    model.sun = pyo.Block(rule=solar_block)
    model.choochoo = pyo.Block(rule=railway_block)
    model.ccplant = pyo.Block(rule=ccsplant_block)
    model.ccstorage = pyo.Block(rule=ccsstor_block)
    model.ccvehicle = pyo.Block(rule=ccsvehicle_block)

    # Objective Function
    def obj_rule(model):
        return sum(model.h2_balance[h] for h in model.H)
    model.obj = pyo.Objective(rule=obj_rule, sense=pyo.minimize)

    return model

#--------------Main Definition--------------#
if __name__ == "__main__":
    model = build_model()
    solver = pyo.SolverFactory("cplex")
    for c in model.component_objects(pyo.Constraint, active=True):
        print(c.name, len(c))
    results = solver.solve(model, tee=True)
    # solver.write()
    print("Termination:", results.solver.termination_condition)
    print("Objective:", pyo.value(model.obj))
    # model.pprint()
    # model.display()




# PLOTS <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
    # for p in model.P:
    #     for m in model.Material:
    #         vals = [(model.plant_inven[p, m, t].value) for t in model.T]
    #         print(f"{m}: {vals}")

    # for p in model.P:
    #     plt.figure(figsize=(10,5))
    #     for r in model.Process:
    #         if (p,r) not in model.PlantProcess:
    #             continue
    #         vals = [(model.process_res[p,r,t].value) for t in model.T]
    #         plt.plot(list(model.T), vals, label=r)
    #     plt.title(f"{p} Process rates")
    #     plt.xlabel("Time")
    #     plt.ylabel("Input Flow")
    #     plt.legend()
    #     plt.grid(True)
    #     plt.show()

    for m in model.Material:
        plt.figure(figsize=(10,5))
        for p in model.P:
            vals = [(model.plant_inven[p,m,t].value) for t in model.T]
            plt.plot(list(model.T), vals, label=p)

        plt.title(f"{m} Inventory")
        plt.xlabel("Time")
        plt.ylabel("Inventory")
        plt.legend()
        plt.grid(True)
        plt.show()